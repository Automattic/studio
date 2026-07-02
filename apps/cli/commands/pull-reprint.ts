/**
 * CLI command: studio pull-reprint
 *
 * Pulls a remote WordPress site into a local Studio site using the
 * streaming site migration protocol and reprint's two-phase file
 * filtering support.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodePassword } from '@studio/common/lib/passwords';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import {
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	SiteRuntime,
	getSiteRuntime,
} from '@studio/common/lib/site-runtime';
import { PullReprintCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import chalk from 'chalk';
import {
	getSetAdminCredentialsRequestBody,
	shouldSetAdminCredentials,
	toUrlSearchParams,
} from 'cli/lib/admin-credentials';
import { enableReprintExporter, rotateReprintSecret } from 'cli/lib/api';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { findSiteByFolder, getSiteUrl, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, isProcessRunning } from 'cli/lib/daemon-client';
import {
	type ReprintProcessResult,
	runReprintCommandUntilComplete,
} from 'cli/lib/pull/migration-client';
import {
	fetchReprintPullTree,
	mapCliOnlyToReprint,
	selectFreshPullOptions,
	selectPullItems,
} from 'cli/lib/pull/reprint-selector';
import {
	getActiveCommand,
	getContentDirFromState,
	hasLocalFilesIndex,
	hasSkippedFiles,
	readReprintState,
	resetEssentialFilesState,
	withActiveCommand,
	writeReprintState,
} from 'cli/lib/pull/reprint-state';
import {
	ensureImportedSiteSqliteReady,
	loadImportedRuntimeStartOptions,
	loadImportedRuntimeStartOptionsNative,
} from 'cli/lib/pull/runtime-start-options';
import { buildAutoLoginUrl } from 'cli/lib/site-utils';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { getPrettyPath } from 'cli/lib/utils';
import {
	startWordPressServer,
	StartServerOptions,
	getProcessName,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncSite } from '@studio/common/types/sync';

const logger = new Logger< LoggerAction >();

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull-reprint',
		describe: __( 'Pull a remote WordPress site using the reprint pull tool' ),
		builder: ( builderYargs ) => {
			return builderYargs
				.option( 'url', {
					type: 'string',
					describe: __( 'URL of the remote WordPress site to pull from (remote source)' ),
				} )
				.option( 'secret', {
					type: 'string',
					describe: __(
						'Shared HMAC secret configured in the migration plugin on the remote source'
					),
				} )
				.option( 'only', {
					type: 'string',
					array: true,
					describe: __(
						'Restrict the pull to specific wp-content folders (e.g. plugins/akismet, themes, uploads); repeatable.'
					),
				} )
				.option( 'skip-database', {
					type: 'boolean',
					describe: __( 'Do not pull the database (keeps the local one)' ),
					default: false,
				} )
				.option( 'skip-uploads', {
					type: 'boolean',
					describe: __( 'Do not pull the media library (uploads)' ),
					default: false,
				} )
				.option( 'verbose', {
					type: 'boolean',
					describe: __( 'Show detailed error information and executed commands' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			const verbose = argv.verbose as boolean;

			try {
				await runCommand(
					argv.path as string,
					argv.url as string | undefined,
					argv.secret as string | undefined,
					verbose,
					{
						only: argv.only as string[] | undefined,
						skipDatabase: argv[ 'skip-database' ] as boolean,
						skipUploads: argv[ 'skip-uploads' ] as boolean,
					}
				);
			} catch ( error ) {
				if ( error instanceof PullError ) {
					logger.spinner.fail( __( 'Pull failed' ) );
					console.error( '\n' + chalk.bold.red( error.message ) );
					if ( verbose && error.technicalDetails ) {
						console.error( '\n' + chalk.dim( error.technicalDetails ) );
					} else if ( error.technicalDetails ) {
						console.error( chalk.dim( '\nRun with --verbose for detailed error output.' ) );
					}
				} else if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to pull site' ), error ) );
				}
			}
		},
	} );
};

/**
 * Where Studio stores the transient progress file and the raw
 * filesystem scratch space for each pulled site.  Each site's pull
 * lives in a subdirectory keyed by its `siteId` (see
 * {@link getPullTechnicalDirectory}).
 */
const PULLS_ROOT = path.join( os.homedir(), '.studio', 'pulls' );

const pullStageOrder = [
	'initialized',
	'pulled',
	'site-registered',
	'site-started',
	'completed',
] as const;

/**
 * The furthest stage the pull pipeline has completed.  Rerunning the
 * command picks up at the first stage after this one, so every phase
 * must only advance here after its output is safely on disk.
 */
type PullStage = ( typeof pullStageOrder )[ number ];

/**
 * Version the stored progress file format to gracefully change it over time.
 */
const PULL_METADATA_VERSION = 1;

/**
 * Selective-sync choice for one pull attempt (interactive selector or
 * `--only`/`--skip-*` flags). Lives in the transient `pull.json`: a resume
 * reuses the choice without re-prompting, while a delta re-pull resets it
 * and asks again.
 */
interface PullSelectionState {
	/** True once the selection step has run, even if nothing was excluded. */
	selectionMade?: boolean;
	skipDatabase?: boolean;
	skipUploads?: boolean;
	/** reprint `--only` source values restricting the file pull. */
	fileOnlyPaths?: string[];
}

interface PullProgress extends PullSelectionState {
	version: number;
	stage: PullStage;
}

interface PullSessionMetadata extends PullSelectionState {
	version: number;
	stage: PullStage;
	sitePath: string;
	localUrl: string;
	technicalSiteDirectory: string;
	rawDirectory: string;
	stateDirectory: string;
	runtimeDirectory: string;
	runtimeBlueprintPath: string;
}

/** Raw selective-sync CLI flags (`--only`, `--skip-database`, `--skip-uploads`). */
interface CliSelectionOptions {
	only?: string[];
	skipDatabase?: boolean;
	skipUploads?: boolean;
}

/**
 * Normalized result of turning CLI arguments into something the pull
 * pipeline can act on: a remote URL to fetch from and the HMAC secret
 * the exporter will check.  For WordPress.com sources we also stash
 * the matched `SyncSite` and auth token so the preflight failure
 * path can rotate a fresh secret without loading the full site list a
 * second time.
 */
interface PullSource {
	secret: string;
	url: string;
	wpComSite?: SyncSite;
	wpComToken?: StoredAuthToken;
}

class PullError extends LoggerError {
	technicalDetails: string;

	constructor( userMessage: string, technicalDetails: string ) {
		super( userMessage );
		this.technicalDetails = technicalDetails;
	}
}

/**
 * Orchestrates a single end-to-end pull with Reprint.phar. Pipeline:
 *
 *   resolveSourceSite (remote source only) →
 *   getPullSessionMetadata →
 *   runPreflight (with secret-rotate retry on WP.com) →
 *   saveReprintOrigin (durable origin onto SiteData) →
 *   runFullPull (one `reprint pull`: files-pull → db-pull → db-apply →
 *     flat-docroot → apply-runtime) →
 *   linkPulledRuntimeToSite (wire the generated runtime onto the
 *     existing site record) →
 *   startWordPressServer →
 *   downloadSkippedFiles.
 *
 * The local site is resolved by `--path` against an existing
 * `SiteData` record (created via `studio create`); this command never
 * creates or deletes a site.  Each Studio stage persists to `pull.json`
 * (see {@link recordCompletedStage}), so a crash resumes at the next
 * stage; within the pull, reprint resumes its own pipeline from its
 * last completed sub-stage.  Teardown is owned entirely by `studio
 * delete`; this command has no abort/rollback verb (Ctrl-C stops the
 * foreground pull, and re-running it resumes idempotently).
 *
 * Re-running after a pull reached 'completed' performs a delta
 * re-pull: Studio's stage machine resets to 'initialized' and reprint
 * resets its own sub-command state via prepare_repull().  Each phase is
 * incremental — files re-sync as a delta (re-index + diff), the
 * database is fully re-downloaded and re-applied (the dump is
 * idempotent, so edits, inserts, and deletes all propagate).
 */
export async function runCommand(
	localPath: string,
	remoteUrl?: string,
	remoteSecret?: string,
	verbose = false,
	cliSelection: CliSelectionOptions = {}
): Promise< void > {
	// The local site must already exist (created via `studio create`).
	// pull-reprint refreshes an existing site from a remote source; it
	// owns neither the creation nor the naming of the local site.
	const site = await findSiteByFolder( localPath );
	if ( ! site ) {
		throw new LoggerError(
			sprintf(
				// translators: %s: the local site path.
				__( 'No Studio site found at %s. Run `studio create` first.' ),
				getPrettyPath( localPath )
			)
		);
	}

	const sourceSite = await resolveSourceSite( site, remoteUrl, remoteSecret, verbose );
	if ( ! sourceSite ) {
		return;
	}

	const { url: sourceSiteUrl } = sourceSite;
	let secret = sourceSite.secret;
	const normalizedRemoteUrl = normalizeSiteUrl( sourceSiteUrl );
	const { created, studioMetadata } = await getPullSessionMetadata( site );
	const apiUrl = getReprintApiUrlForSite( normalizedRemoteUrl );

	// A previously completed pull re-runs as a delta sync: reset the
	// stage machine so every phase executes again. Reprint does the
	// incremental work against the preserved state directory — files
	// re-sync as a delta (re-index + diff), the database is fully
	// re-downloaded and re-applied (the dump is idempotent, so remote
	// edits, inserts, and deletes all land locally).
	const isRepull = studioMetadata.stage === 'completed';
	if ( isRepull ) {
		studioMetadata.stage = 'initialized';
		// A delta re-pull must prompt for a fresh selective-sync choice.
		clearSelection( studioMetadata );
		savePullProgress( studioMetadata );
		// A completed pull.json implies a full pull happened; backfill the
		// durable marker in case it predates the importComplete flag.
		await markImportComplete( site );

		// Re-verify connectivity (and give the secret-rotation retry path
		// a chance to run) instead of trusting the cached preflight from
		// the original pull, which may be days old.
		fs.rmSync( path.join( studioMetadata.stateDirectory, 'preflight.json' ), { force: true } );
	}

	// The target site pre-exists (created via `studio create`), so its
	// directory legitimately holds the blank WordPress install. The pull's
	// flatten stage overwrites it with the remote site's files; an
	// interrupted pull can therefore leave the site partially written.
	// Crash atomicity is a deferred follow-up (see the refactor overview).

	// Create the `~/.studio/pulls/<siteId>` directory structure for the
	// pull session scratch space.
	fs.mkdirSync( studioMetadata.rawDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.stateDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.runtimeDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.sitePath, { recursive: true } );

	const isResume = ! created || fs.readdirSync( studioMetadata.stateDirectory ).length > 0;
	if ( isRepull ) {
		console.log( `Updating "${ site.name }" from ${ normalizedRemoteUrl } (delta sync)` );
		console.log( '' );
	} else if ( isResume ) {
		console.log( `Resuming previous pull of "${ site.name }" from ${ normalizedRemoteUrl }` );
		console.log( '' );
	} else {
		console.log( `Pulling "${ site.name }" from ${ normalizedRemoteUrl }` );
	}
	console.log( `Technical directory: ${ studioMetadata.technicalSiteDirectory }` );
	console.log( `Site directory: ${ studioMetadata.sitePath }` );
	console.log( '' );

	try {
		// Activate the reprint exporter on the target site before any
		// direct request.  wpcomsh gates the ?reprint-api endpoint on
		// a `reprint_exporter_enabled` timestamp set within the last
		// 60 minutes; without this the first preflight would be refused.
		// Runs on every pull (including resumes) since the sliding
		// window may have expired between runs.
		if ( sourceSite.wpComSite && sourceSite.wpComToken ) {
			await enableReprintExporter(
				sourceSite.wpComSite.id,
				sourceSite.wpComToken.accessToken,
				verbose
			);
		}

		let preflight;
		try {
			preflight = await runPreflight(
				SITE_RUNTIME_NATIVE_PHP,
				studioMetadata,
				apiUrl,
				secret,
				verbose
			);
		} catch ( preflightError ) {
			// Preflight against ?reprint-api can fail for two reasons we can
			// recover from on WP.com: the stored secret expired, or the
			// wpcomsh exporter gate (`reprint_exporter_enabled`, a 60-minute
			// sliding window) closed since the last run.  A cached-secret
			// resume skips the happy-path enable above, so this is the common
			// case on a delta re-pull.  Resolve the WP.com site (loading the
			// site list only now, if we haven't already), then both rotate the
			// secret AND re-enable the exporter before retrying.
			if ( sourceSite.wpComSite && sourceSite.wpComToken ) {
				secret = await rotateReprintSecret(
					sourceSite.wpComSite.id,
					sourceSite.wpComToken.accessToken
				);
			} else {
				let token: StoredAuthToken | null;
				try {
					token = await readAuthToken();
				} catch {
					token = null;
				}
				if ( ! token ) {
					throw preflightError;
				}
				const sites = await fetchSyncableSites( token.accessToken );
				const matched = findMatchingWpComSite( sites, sourceSiteUrl );
				// Only syncable sites (hosting features enabled) can run the
				// reprint exporter and rotate a secret.
				if ( ! matched || matched.syncSupport !== 'syncable' ) {
					throw preflightError;
				}
				sourceSite.wpComSite = matched;
				sourceSite.wpComToken = token;
				secret = await rotateReprintSecret( matched.id, token.accessToken );
			}
			// Rotating the secret does not bump `reprint_exporter_enabled`, so
			// re-open the gate explicitly; otherwise the retry hits the same
			// closed window and ?reprint-api falls through to an HTML page.
			await enableReprintExporter(
				sourceSite.wpComSite.id,
				sourceSite.wpComToken.accessToken,
				verbose
			);
			preflight = await runPreflight(
				SITE_RUNTIME_NATIVE_PHP,
				studioMetadata,
				apiUrl,
				secret,
				verbose
			);
		}
		// Persist the durable origin onto the site record (not pull.json):
		// where it syncs from, the remote's self-reported siteurl, the table
		// prefix, and the (possibly rotated) secret a resume will reuse.
		const origin = {
			remoteUrl: normalizedRemoteUrl,
			remoteSiteUrl: preflight.siteurl || normalizedRemoteUrl,
			tablePrefix: preflight.table_prefix || undefined,
			secret,
		};
		site.reprintOrigin = origin;
		await updateSiteRecord( site.id, ( record ) => {
			record.reprintOrigin = origin;
		} );

		// db-apply (run inside the composite `pull`) rewrites the remote
		// site URL to the local one the Studio server already serves —
		// `studioMetadata.localUrl` comes from the existing site's port, so
		// no port allocation is needed here.

		// Resolve what to sync (flags or interactive prompt); resumes reuse
		// the choice persisted in pull.json.
		const proceed = await applySelection( {
			metadata: studioMetadata,
			// Without the local index (cleared/damaged scratch) a
			// folder-restricted pull could not include core, so treat it as a
			// first pull even when importComplete is set.
			isFirstPull: ! site.importComplete || ! hasLocalFilesIndex( studioMetadata.stateDirectory ),
			cli: cliSelection,
			apiUrl,
			secret,
			verbose,
		} );
		if ( ! proceed ) {
			return;
		}

		// The pull pipeline runs as separate reprint commands (pull-files →
		// pull-db → flat-docroot → apply-runtime) so the selection can skip
		// the database step entirely; see runFullPull.
		if ( ! hasPullCompletedStage( studioMetadata, 'pulled' ) ) {
			normalizeReprintStateForEssentialFilesPull( studioMetadata.stateDirectory );
			await runFullPull( SITE_RUNTIME_NATIVE_PHP, studioMetadata, apiUrl, secret, verbose );
		}

		// The site record already exists (created via `studio create`); the
		// pull only needs to wire the generated technical directory and
		// runtime Blueprint onto it so `studio start` and the daemon serve
		// the imported runtime rather than the original blank install.
		if ( ! hasPullCompletedStage( studioMetadata, 'site-registered' ) ) {
			logger.reportStart( LoggerAction.CREATE_SITE, `Linking pulled files to "${ site.name }"…` );
			site.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
			site.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
			await updateSiteRecord( site.id, ( record ) => {
				record.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
				record.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
			} );
			logger.reportSuccess( `Site "${ site.name }" updated` );
			recordCompletedStage( studioMetadata, 'site-registered' );
			logger.reportKeyValuePair( 'id', site.id );
		}

		// Imported sites' databases come from the remote dump, which lacks
		// the local admin user. Without this, the auto-login mu-plugin can't
		// find an admin user (it falls back to looking for "admin" which
		// doesn't exist in the imported database).
		if ( ! site.adminPassword ) {
			const adminPassword = encodePassword( crypto.randomBytes( 24 ).toString( 'base64url' ) );
			site.adminPassword = adminPassword;
			await updateSiteRecord( site.id, ( record ) => {
				record.adminPassword = adminPassword;
			} );
		}

		if ( ! hasPullCompletedStage( studioMetadata, 'site-started' ) ) {
			let runtimeStartOptions: StartServerOptions;
			if ( getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP ) {
				runtimeStartOptions = loadImportedRuntimeStartOptionsNative(
					studioMetadata.technicalSiteDirectory,
					studioMetadata.runtimeDirectory
				);
			} else {
				await ensureImportedSiteSqliteReady( studioMetadata.runtimeBlueprintPath );
				runtimeStartOptions = await loadImportedRuntimeStartOptions(
					studioMetadata.runtimeBlueprintPath
				);
			}

			// Persist the computed start options so `studio site start` and
			// the daemon can re-read them without recomputing (which spins
			// up PHP WASM to extract runtime.php constants).
			const startOptionsPath = path.join( studioMetadata.runtimeDirectory, 'start-options.json' );
			fs.writeFileSync( startOptionsPath, JSON.stringify( runtimeStartOptions, null, 2 ) + '\n' );

			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );

			try {
				await connectToDaemon();

				// On a re-pull, the site's server is often already running.
				// The synced files and database are picked up live (PHP
				// opens them per request), so there's nothing to restart —
				// but db-apply rebuilt the database from the remote dump,
				// wiping the local admin user and the studio_admin_username
				// option that /studio-auto-login depends on.  A server start
				// re-applies the credentials; when we skip the restart we
				// must re-apply them over the running site's admin API.
				// A connection failure means the daemon's view is stale and
				// the server is actually down, so fall through to a start
				// (which re-applies the credentials itself).
				const runningProcess = await isProcessRunning( getProcessName( site.id ) );
				const credentialsResult = runningProcess
					? await reapplyAdminCredentials( site )
					: 'unreachable';
				if ( runningProcess && credentialsResult !== 'unreachable' ) {
					logger.reportSuccess( __( 'WordPress server already running' ) );
					// Mirror the start branch (and `studio site start`'s
					// already-running path): refresh latestCliPid so
					// running-status checks match the live process.
					if ( runningProcess.status === 'online' ) {
						await updateSiteLatestCliPid( site.id, runningProcess.pid );
					}
					recordCompletedStage( studioMetadata, 'site-started' );
				} else {
					const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
					logger.reportSuccess( __( 'WordPress server started' ) );

					if ( processDesc.status === 'online' ) {
						await updateSiteLatestCliPid( site.id, processDesc.pid );
					}
					recordCompletedStage( studioMetadata, 'site-started' );
				}
			} catch ( serverError ) {
				throw new LoggerError(
					__( 'Failed to start the WordPress server for the pulled site.' ),
					serverError
				);
			} finally {
				await disconnectFromDaemon();
			}
		}

		if ( studioMetadata.localUrl ) {
			console.log( '' );
			console.log( `Site "${ site.name }" is ready.` );
			console.log( '' );
			printSiteUrls( studioMetadata.localUrl );
		}

		if ( ! hasPullCompletedStage( studioMetadata, 'completed' ) ) {
			// Fetch the deferred media/uploads unless the user excluded the
			// media library in the selective-sync choice.
			if ( ! studioMetadata.skipUploads && hasSkippedFiles( studioMetadata.stateDirectory ) ) {
				await downloadSkippedFiles(
					getSiteRuntime( site ),
					studioMetadata,
					apiUrl,
					secret,
					verbose
				);
			}

			recordCompletedStage( studioMetadata, 'completed' );
			// A full pull just finished — record the durable marker that
			// drives first-full-pull vs. delta decisions independent of
			// the transient pull.json.
			await markImportComplete( site );
		}

		printCompletionMessage( site, studioMetadata.localUrl );
		process.exit( 0 );
	} catch ( error ) {
		const resumeCommand = [
			'studio pull-reprint',
			`--path "${ localPath }"`,
			`--url ${ normalizedRemoteUrl }`,
		];
		if ( remoteSecret ) {
			resumeCommand.push( '--secret <secret>' );
		}
		console.log( '' );
		console.log( 'To resume this pull, re-run the same command:' );
		console.log( `  ${ resumeCommand.join( ' ' ) }` );
		console.log( '' );

		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to pull site' ), error );
	}
}

function clearSelection( metadata: PullSessionMetadata ): void {
	metadata.selectionMade = undefined;
	metadata.skipDatabase = undefined;
	metadata.skipUploads = undefined;
	metadata.fileOnlyPaths = undefined;
}

/**
 * Resolve the selective-sync choice (persisted choice, CLI flags, or
 * interactive prompt, in that order) and record it on the metadata +
 * `pull.json`. Returns `false` when the user cancels the prompt.
 *
 * On a first pull only the media library is optional — see the module
 * comment in `reprint-selector.ts` for why `--only`/`--skip-database`
 * cannot work before core has been pulled.
 */
async function applySelection( params: {
	metadata: PullSessionMetadata;
	isFirstPull: boolean;
	cli: CliSelectionOptions;
	apiUrl: string;
	secret: string;
	verbose: boolean;
} ): Promise< boolean > {
	const { metadata, isFirstPull, cli, apiUrl, secret, verbose } = params;
	const commitSelection = () => {
		metadata.selectionMade = true;
		savePullProgress( metadata );
	};

	// A folder selection persisted for what is now a first pull (the scratch
	// was cleared since it was captured) cannot produce a working site; drop
	// it and choose again.
	if ( isFirstPull && ( metadata.fileOnlyPaths !== undefined || metadata.skipDatabase ) ) {
		clearSelection( metadata );
		savePullProgress( metadata );
	}

	if ( hasPullCompletedStage( metadata, 'pulled' ) || metadata.selectionMade ) {
		return true;
	}

	const cliOnly = cli.only?.filter( ( value ) => value.trim().length > 0 ) ?? [];
	const cliDriven = cliOnly.length > 0 || cli.skipDatabase || cli.skipUploads;

	if ( cliDriven ) {
		if ( isFirstPull && ( cliOnly.length > 0 || cli.skipDatabase ) ) {
			throw new LoggerError(
				__(
					"The first pull of a site must download WordPress core and the database, so `--only` and `--skip-database` aren't available yet (`--skip-uploads` is). Run a full pull first; folder-level selection works on subsequent pulls."
				)
			);
		}
		if ( cliOnly.length > 0 ) {
			const contentDir = getContentDirFromState( metadata.stateDirectory ) ?? '';
			metadata.fileOnlyPaths = mapCliOnlyToReprint( cliOnly, contentDir );
		}
		metadata.skipDatabase = !! cli.skipDatabase;
		metadata.skipUploads = !! cli.skipUploads;
		commitSelection();
		return true;
	}

	if ( ! process.stdin.isTTY ) {
		return true; // non-interactive, no flags → full pull
	}

	if ( isFirstPull ) {
		const fresh = await selectFreshPullOptions();
		metadata.skipUploads = fresh.skipUploads;
		commitSelection();
		return true;
	}

	const { tree, contentDir } = await fetchReprintPullTree( {
		stateDirectory: metadata.stateDirectory,
		rawDirectory: metadata.rawDirectory,
		apiUrl,
		secret,
		runtime: SITE_RUNTIME_NATIVE_PHP,
		verbose,
	} );
	if ( tree.length === 0 || ! contentDir ) {
		commitSelection();
		return true;
	}
	const selection = await selectPullItems( tree, contentDir );
	if ( ! selection ) {
		console.log( __( 'Cancelled.' ) );
		return false;
	}
	metadata.fileOnlyPaths = selection.fileOnlyPaths;
	metadata.skipDatabase = selection.skipDatabase;
	commitSelection();
	// Keep reprint's state intact here: the follow-up file pull needs the
	// local index (`.import-index.jsonl`) to run as a delta into the
	// non-empty raw fs-root.
	return true;
}

/**
 * Runs `reprint preflight` against the remote site and caches the
 * response envelope at `stateDirectory/preflight.json`.
 *
 * The first direct request to the site happens here — a failure from
 * an expired secret or a disabled exporter surfaces as a recognizable
 * PullError that the pull orchestrator turns into a secret-rotation
 * retry (for WP.com sources) or a user-facing abort.  Returns the
 * handful of site-identity fields runCommand needs to record on the
 * metadata before the download stages begin.
 */
async function runPreflight(
	runtime: SiteRuntime,
	sessionMetadata: PullSessionMetadata,
	sourceSiteApiUrl: string,
	sourceSiteSecret: string,
	verbose = false
): Promise< {
	siteurl?: string;
	wp_version?: string;
	php_version?: string;
	table_prefix?: string;
} > {
	const preflightCachePath = path.join( sessionMetadata.stateDirectory, 'preflight.json' );

	if ( fs.existsSync( preflightCachePath ) ) {
		return JSON.parse( fs.readFileSync( preflightCachePath, 'utf-8' ) );
	}

	logger.reportStart( LoggerAction.PREFLIGHT, __( 'Initiating the migration…' ) );

	let preflightResult: ReprintProcessResult;
	try {
		preflightResult = await runReprintCommandUntilComplete(
			sessionMetadata.stateDirectory,
			sessionMetadata.rawDirectory,
			[
				'preflight',
				sourceSiteApiUrl,
				`--secret=${ sourceSiteSecret }`,
				'--no-adaptive',
				`--state-dir=${ sessionMetadata.stateDirectory }`,
				`--fs-root=${ sessionMetadata.rawDirectory }`,
			],
			undefined,
			{
				verboseCommands: verbose,
				runtime,
			}
		);
	} catch ( preflightError ) {
		const details =
			preflightError instanceof Error ? preflightError.message : String( preflightError );
		throw new PullError( __( 'Could not connect to the remote site.' ), details );
	}

	// migration-client already extracted the last JSON-L line (the result
	// envelope) into preflightResult.stdout.  Just parse it.
	const raw = preflightResult.stdout.trim();
	let envelope: Record< string, unknown >;
	try {
		envelope = JSON.parse( raw );
	} catch {
		throw new PullError(
			__( 'The remote site did not respond with a recognized format.' ),
			`stdout: ${ raw }\nstderr: ${ preflightResult.stderr }`
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const preflightData: any = envelope.data ?? envelope;
	if ( ! preflightData.ok ) {
		const errorDetail = preflightData.error || '';
		const isJsonParseError = /^Invalid JSON\b/i.test( String( errorDetail ) );
		const userMessage = isJsonParseError
			? __( 'The remote site responded with HTML instead of the expected export API.' )
			: __( 'Remote site preflight check failed.' );

		throw new PullError(
			userMessage,
			preflightResult.stdout.trim() + '\n' + preflightResult.stderr.trim()
		);
	}

	const preflight = {
		siteurl: preflightData.database?.wp?.siteurl || undefined,
		wp_version: preflightData.database?.wp?.wp_version || undefined,
		php_version: preflightData.php?.version || undefined,
		table_prefix: preflightData.database?.wp?.table_prefix || undefined,
	};

	fs.writeFileSync( preflightCachePath, JSON.stringify( preflight, null, 2 ) + '\n' );
	logger.reportSuccess(
		`Connected – WordPress ${ preflight.wp_version || 'unknown' }, PHP ${
			preflight.php_version || 'unknown'
		}`
	);
	return preflight;
}

/**
 * Answers "has this pull already finished the given pipeline stage?".
 *
 * Pull stages are strictly ordered (see {@link pullStageOrder}:
 * initialized → essential-files-complete → flattened → db-downloaded →
 * db-applied → runtime-generated → site-registered → site-started →
 * completed), and `metadata.stage` always holds the last one that
 * reached disk via {@link recordCompletedStage}.  Every phase in
 * runCommand uses this as its resume guard — when it returns true the
 * phase is skipped on re-run.
 */
function hasPullCompletedStage( metadata: PullSessionMetadata, stage: PullStage ): boolean {
	return pullStageOrder.indexOf( metadata.stage ) >= pullStageOrder.indexOf( stage );
}

/**
 * Reprint refuses to resume a files sync with a different --filter than
 * the one stored in its state. A completed Studio pull may leave that
 * state on the post-pull skipped-earlier pass; mark that pass complete
 * and restore the filter expected by the next essential-files pull
 * without deleting the cursor/index files reprint needs for deltas.
 */
function normalizeReprintStateForEssentialFilesPull( stateDirectory: string ): void {
	const reprintState = readReprintState( stateDirectory );
	if ( reprintState?.filter && reprintState.filter !== 'essential-files' ) {
		const { commandName } = getActiveCommand( reprintState );
		writeReprintState(
			stateDirectory,
			withActiveCommand(
				{ ...reprintState, filter: 'essential-files' },
				{
					commandName: commandName ?? 'files-pull',
					completionState: 'complete',
					currentStage: null,
				}
			)
		);
	}
}

/**
 * The `~/.studio/pulls/<siteId>` scratch root for a site's pull. Keyed
 * by `siteId` (not a URL hash) so it follows the site, not the remote.
 */
function getPullTechnicalDirectory( siteId: string ): string {
	return path.join( PULLS_ROOT, siteId );
}

function getMetadataPath( technicalSiteDirectory: string ): string {
	return path.join( technicalSiteDirectory, 'pull.json' );
}

/**
 * Persist the transient pull progress file (`pull.json`) so a rerun
 * resumes from the last completed Studio-side stage rather than starting
 * over.  Written atomically via a temp file + rename so a crash mid-write
 * leaves the previous snapshot intact.
 *
 * Distinct from reprint's own `.import-state.json` (read/written by
 * {@link readReprintState} in `reprint-state.ts`): that file is
 * reprint.phar's internal cursor for an individual command — what file
 * it was syncing, which byte it stopped at, what the preflight returned.
 * `pull.json` is Studio's higher-level pipeline state — which of the
 * {@link pullStageOrder} stages have finished.  Everything else the next
 * run needs lives on the {@link SiteData} record.
 */
function savePullProgress( metadata: PullSessionMetadata ): void {
	fs.mkdirSync( metadata.technicalSiteDirectory, { recursive: true } );
	const metadataPath = getMetadataPath( metadata.technicalSiteDirectory );
	const progress: PullProgress = {
		version: metadata.version,
		stage: metadata.stage,
		selectionMade: metadata.selectionMade,
		skipDatabase: metadata.skipDatabase,
		skipUploads: metadata.skipUploads,
		fileOnlyPaths: metadata.fileOnlyPaths,
	};
	const tempPath = `${ metadataPath }.tmp`;
	fs.writeFileSync( tempPath, JSON.stringify( progress, null, 2 ) + '\n' );
	fs.renameSync( tempPath, metadataPath );
}

function readPullProgress( technicalSiteDirectory: string ): PullProgress | null {
	let raw: string;
	try {
		raw = fs.readFileSync( getMetadataPath( technicalSiteDirectory ), 'utf-8' );
	} catch ( error: unknown ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return null;
		}
		throw error;
	}

	const progress = JSON.parse( raw ) as PullProgress;
	if ( progress.version !== PULL_METADATA_VERSION ) {
		return null;
	}
	return progress;
}

/**
 * Run the site-clone pipeline as separate reprint commands so the
 * selective-sync choice maps directly onto them:
 *
 *   1. `pull-files`    — preflight + file download. `--only` restricts the
 *      pull to the wp-content folders the user selected.
 *   2. `pull-db`       — SQL download + import into SQLite. **Skipped
 *      entirely** when the user excluded the database, leaving the local
 *      database untouched.
 *   3. `flat-docroot`  — reassemble the raw download into the site
 *      directory (`--force` overwrites the pre-existing blank install).
 *   4. `apply-runtime` — server config, run last so it embeds the DB
 *      credentials `pull-db` wrote to state (or keeps the previous ones
 *      when the database was skipped).
 *
 * The SQLite target geometry:
 *   - If preflight exposed the remote `wp-content` (contentDir set),
 *     the database lands under `rawDirectory + contentDir`, an
 *     already-mounted host path that flat-docroot later symlinks into
 *     the flattened site.
 *   - Otherwise it falls back to `sitePath/wp-content`.
 *
 * The flattened site and runtime output directories are mounted up
 * front so the forks can write them onto the host filesystem. Each
 * command is individually resumable (exit code 2 → retry loop in
 * {@link runReprintCommandUntilComplete}); a crash between commands
 * safely re-runs the sequence, since every step is idempotent.
 *
 * Advances the pull stage to 'pulled'.
 */
export async function runFullPull(
	runtime: SiteRuntime,
	metadata: PullSessionMetadata,
	apiUrl: string,
	secret: string,
	verbose: boolean
): Promise< void > {
	const contentDir = getContentDirFromState( metadata.stateDirectory );
	const sqlitePath = contentDir
		? `${ metadata.rawDirectory }${ contentDir }/database/.ht.sqlite`
		: `${ metadata.sitePath }/wp-content/database/.ht.sqlite`;
	const reprintRuntime = runtime === SITE_RUNTIME_NATIVE_PHP ? 'nginx-fpm' : 'playground-cli';
	const onlyArgs = ( metadata.fileOnlyPaths ?? [] ).map( ( onlyPath ) => `--only=${ onlyPath }` );

	const runStep = ( progressLabel: string, args: string[] ) =>
		runReprintCommandUntilComplete(
			metadata.stateDirectory,
			metadata.rawDirectory,
			args,
			( progress ) => logger.reportProgress( progress ),
			{
				progressLabel,
				mounts: [
					{ hostPath: metadata.sitePath, vfsPath: metadata.sitePath },
					{ hostPath: metadata.runtimeDirectory, vfsPath: metadata.runtimeDirectory },
				],
				verboseCommands: verbose,
				runtime,
			}
		);

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Pulling site…' ) );

	// A non-empty raw fs-root without a local files index is a damaged or
	// partially-written scratch: reprint refuses an initial sync into it
	// ("Target directory is not empty and no cursor found"), and its
	// preserve-local escape hatch silently skips every file behind a stale
	// blocker entry. The raw directory is Studio-owned scratch, so clear it
	// and start a clean initial sync instead (preflight state is preserved;
	// the selection gate guarantees this run pulls everything, database
	// included, so no other reprint state needs to survive).
	const rawEntries = fs.existsSync( metadata.rawDirectory )
		? fs.readdirSync( metadata.rawDirectory )
		: [];
	if ( rawEntries.length > 0 && ! hasLocalFilesIndex( metadata.stateDirectory ) ) {
		fs.rmSync( metadata.rawDirectory, { recursive: true, force: true } );
		fs.mkdirSync( metadata.rawDirectory, { recursive: true } );
		resetEssentialFilesState( metadata.stateDirectory );
	}

	// 1. Files. `--only` restricts the download to the selected wp-content
	// folders; essential-files defers the media library to the post-start
	// skipped-earlier pass.
	await runStep( __( 'Pulling files' ), [
		'pull-files',
		apiUrl,
		`--secret=${ secret }`,
		'--filter=essential-files',
		...onlyArgs,
		'--no-adaptive',
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	] );

	// 2. Database — only when selected. Skipping it leaves the local
	// database (and the runtime's DB credentials in state) untouched.
	if ( ! metadata.skipDatabase ) {
		await runStep( __( 'Pulling database' ), [
			'pull-db',
			apiUrl,
			`--secret=${ secret }`,
			'--target-engine=sqlite',
			`--target-sqlite-path=${ sqlitePath }`,
			`--new-site-url=${ metadata.localUrl! }`,
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
		] );
	}

	// 3. Flatten the raw download into the site directory. `-` is the URL
	// placeholder for local commands; `--force` overwrites the blank
	// install `studio create` left in the pre-existing site directory.
	await runStep( __( 'Flattening layout' ), [
		'flat-docroot',
		'-',
		`--flatten-to=${ metadata.sitePath }`,
		'--force',
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	] );

	// 4. Runtime config — last, so it reads the DB credentials pull-db wrote
	// to state. apply-runtime takes no URL positional, and
	// --flat-document-root replaces --fs-root (they are mutually exclusive).
	await runStep( __( 'Preparing runtime' ), [
		'apply-runtime',
		`--runtime=${ reprintRuntime }`,
		`--output-dir=${ metadata.runtimeDirectory }`,
		`--flat-document-root=${ metadata.sitePath }`,
		`--state-dir=${ metadata.stateDirectory }`,
	] );

	logger.reportSuccess( __( 'Site pulled' ) );
	recordCompletedStage( metadata, 'pulled' );
}

/**
 * Second-phase file sync: fetch the wp-content entries that the
 * essential-files pass deliberately skipped (unused plugins/themes,
 * large caches).  Runs after the site is already up so the user can
 * poke around while the tail downloads in the background.
 *
 * When reprint is already mid-way through a skipped-earlier run
 * (status=partial, stage=fetch-skipped), the state file already
 * encodes the resumption point — overwriting it would break reprint's
 * internal validation, so we leave the state alone in that case.
 */
export async function downloadSkippedFiles(
	runtime: SiteRuntime,
	metadata: PullSessionMetadata,
	apiUrl: string,
	secret: string,
	verbose: boolean
): Promise< void > {
	const reprintState = readReprintState( metadata.stateDirectory );
	const activeCommand = getActiveCommand( reprintState );
	const isResumingSkipped =
		activeCommand.currentStage === 'fetch-skipped' && activeCommand.completionState !== 'complete';

	// Rewrite the reprint state so the next files-sync understands it
	// should download the entries the essential-files pass skipped: the
	// skipped-earlier filter is only accepted when the checkpoint says a
	// files-pull completed with filter=essential-files (after the split
	// pipeline, the checkpoint points at the last command that ran, e.g.
	// db-apply or apply-runtime). No-op when reprint is already mid-way
	// through that run (its state file encodes the resume cursor;
	// overwriting would break validation) or when no skipped entries exist.
	if ( ! isResumingSkipped && hasSkippedFiles( metadata.stateDirectory ) ) {
		writeReprintState(
			metadata.stateDirectory,
			withActiveCommand(
				{ ...reprintState, filter: 'essential-files' },
				{ commandName: 'files-pull', completionState: 'complete', currentStage: null }
			)
		);
	}

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Downloading remaining files…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		buildFilesSyncArgs( metadata, apiUrl, secret, [
			...( isResumingSkipped ? [] : [ '--filter=skipped-earlier' ] ),
		] ),
		( progress ) => logger.reportProgress( progress ),
		{
			progressLabel: __( 'Remaining files' ),
			verboseCommands: verbose,
			runtime,
		}
	);
	logger.reportSuccess( __( 'Remaining files downloaded' ) );
}

export function normalizeSiteUrl( url: string ): string {
	const trimmedUrl = url.trim();
	const normalized = new URL(
		/^[a-z][a-z\d+.-]*:\/\//i.test( trimmedUrl ) ? trimmedUrl : `https://${ trimmedUrl }`
	);
	normalized.hash = '';
	normalized.pathname = normalized.pathname.replace( /\/+$/, '' ) || '/';
	normalized.searchParams.delete( 'reprint-api' );
	return normalized.toString();
}

/**
 * Finds the WordPress.com site in the user's connected list whose
 * public URL best matches `url`.  Matches on the full normalized URL
 * first, then falls back to host-only matching so `example.com` and
 * `example.com/blog` both resolve to the same WP.com site record.
 *
 * No existing Studio helper does this today — `getSiteByFolder` /
 * `getHostnameFromUrl` operate on local sites or return a string, and
 * `findSite` variants all key on site id.  Keep this one local to
 * pull-reprint; if a second caller ever needs the same shape, the
 * natural home would be `cli/lib/wpcom-sites`.
 */
export function findMatchingWpComSite< T extends { url: string } >(
	sites: T[],
	url: string
): T | undefined {
	const normalizedUrl = normalizeSiteUrl( url );
	const target = new URL( normalizedUrl );

	return sites.find( ( site ) => {
		try {
			const normalizedSiteUrl = normalizeSiteUrl( site.url );
			if ( normalizedSiteUrl === normalizedUrl ) {
				return true;
			}

			return new URL( normalizedSiteUrl ).host === target.host;
		} catch {
			return false;
		}
	} );
}

/**
 * Resolves the **remote source** to pull from — never the local site,
 * which `runCommand` resolves separately by `--path` and passes in as
 * `site` (used only to read its cached origin secret).  Returns the
 * remote `url`/`secret` (plus the matched WordPress.com site + token
 * when applicable).  Handles three input patterns:
 *
 *   1. `--url` + `--secret` — trusted pair, used as-is (self-hosted
 *      sites and arbitrary URLs).
 *   2. A site with a saved `reprintOrigin` (set by a previous pull),
 *      with either no `--url` or a `--url` that matches that origin —
 *      reuse the saved remote URL and HMAC secret so a re-pull needs no
 *      remote re-selection or secret re-rotation. An explicit `--secret`
 *      still overrides the stored one. If the stored secret is stale,
 *      preflight 403s and the WP.com retry path rotates a fresh one.
 *   3. `--url` with no matching stored secret — resolve it against the
 *      connected WordPress.com sites and rotate a fresh secret.
 *   4. No `--url` and no saved origin — among pullable (`syncable`)
 *      sites only: if the user has exactly one, pick it; with several,
 *      show an interactive picker in a TTY (returning `null` if the user
 *      cancels) or error out when run non-interactively. Non-pullable
 *      sites (Simple, or missing hosting features) are surfaced as
 *      disabled in the picker.
 */
export async function resolveSourceSite(
	site: SiteData,
	url?: string,
	providedSecret?: string,
	_verbose = false
): Promise< PullSource | null > {
	// When the caller provides an explicit secret, use it directly.
	if ( url && providedSecret ) {
		return { url, secret: providedSecret };
	}

	// Reuse the site's saved origin from its last successful pull when no
	// `--url` is given (default to the same remote) or when `--url` points
	// at that same remote — so a re-pull doesn't force the user to
	// re-select the remote or re-rotate the secret on every run. An
	// explicit `--secret` still overrides the stored one.
	if (
		site.reprintOrigin &&
		( ! url || normalizeSiteUrl( url ) === site.reprintOrigin.remoteUrl )
	) {
		return {
			url: url ?? site.reprintOrigin.remoteUrl,
			secret: providedSecret ?? site.reprintOrigin.secret,
		};
	}

	// Need the full site list: either no URL was given (interactive pick) or
	// no stored secret exists and we need the site ID to rotate one.
	const token = await readAuthToken();
	if ( ! token ) {
		throw new LoggerError(
			__(
				'WordPress.com authentication is required. Run `studio auth login` to pull a connected WordPress.com site, or provide both `--url` and `--secret` for a non-WordPress.com site.'
			)
		);
	}
	let sites: SyncSite[];
	try {
		sites = await fetchSyncableSites( token.accessToken );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to load WordPress.com sites' ), error );
	}

	let resolvedUrl: string;
	let wpComSite: SyncSite;

	if ( url ) {
		const matched = findMatchingWpComSite( sites, url );
		if ( ! matched ) {
			throw new LoggerError(
				__(
					'No secret was provided, and this URL is not one of your connected WordPress.com sites. Provide `--secret` for a non-WordPress.com site.'
				)
			);
		}
		if ( matched.syncSupport !== 'syncable' ) {
			throw new LoggerError(
				sprintf(
					// translators: %s: the site URL.
					__(
						'%s cannot be pulled. Pulling requires a WordPress.com site with hosting features enabled, or a self-hosted site (with `--url` and `--secret`).'
					),
					matched.url
				)
			);
		}
		resolvedUrl = url;
		wpComSite = matched;
	} else {
		// Only sites that can run the reprint exporter — those with hosting
		// features enabled (`syncable`) — are pull candidates.
		const pullableSites = sites.filter( ( site ) => site.syncSupport === 'syncable' );
		if ( pullableSites.length === 0 ) {
			throw new LoggerError(
				__(
					'No pullable WordPress.com sites found. Pulling requires a WordPress.com site with hosting features; provide both `--url` and `--secret` to pull a self-hosted site.'
				)
			);
		}

		if ( pullableSites.length > 1 ) {
			// In a real terminal, let the user pick interactively. Outside a
			// TTY (CI, or Studio driving the command) there's no way to
			// prompt, so exit with guidance to pass `--url` — the realistic
			// non-TTY caller already does.
			if ( ! process.stdin.isTTY ) {
				throw new LoggerError(
					__( 'Multiple WordPress.com sites are available. Re-run with `--url <site-url>`.' )
				);
			}

			// Pass the full list so non-pullable sites render disabled with a
			// reason, matching the `pull` command.
			const picked = await pickSyncSite( sites, __( 'Select a site to pull from' ) );
			// Esc / Ctrl-C cancels the picker. Treat it as a clean no-op: the
			// caller returns early without creating any local state.
			if ( ! picked ) {
				return null;
			}

			wpComSite = picked;
			resolvedUrl = picked.url;
		} else {
			// If the user only has one pullable WordPress.com site, pull it by default.
			wpComSite = pullableSites[ 0 ];
			resolvedUrl = wpComSite.url;
			console.log( `${ __( 'Using your only connected WordPress.com site:' ) } ${ resolvedUrl }` );
			console.log( '' );
		}
	}

	return {
		url: resolvedUrl,
		secret: await rotateReprintSecret( wpComSite.id, token.accessToken ),
		wpComSite,
		wpComToken: token,
	};
}

/**
 * Builds (or resumes) the working pull state for refreshing an existing
 * Studio `site`.
 *
 * Identity and layout come from the {@link SiteData} record (the scratch
 * directory is keyed by `site.id`); the only thing read from disk is the
 * transient {@link PullProgress} (`pull.json`), so `created` reflects
 * whether a prior in-flight pull exists for this site.
 */
export async function getPullSessionMetadata( site: SiteData ) {
	const technicalSiteDirectory = getPullTechnicalDirectory( site.id );
	const existing = readPullProgress( technicalSiteDirectory );
	const progress: PullProgress = existing ?? {
		version: PULL_METADATA_VERSION,
		stage: 'initialized',
	};
	const metadata = {
		version: progress.version,
		stage: progress.stage,
		selectionMade: progress.selectionMade,
		skipDatabase: progress.skipDatabase,
		skipUploads: progress.skipUploads,
		fileOnlyPaths: progress.fileOnlyPaths,
		sitePath: site.path,
		localUrl: getSiteUrl( site ),
		technicalSiteDirectory,
		rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
		stateDirectory: path.join( technicalSiteDirectory, 'state' ),
		runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
		runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
	};

	if ( ! existing ) {
		savePullProgress( metadata );
	}
	return { created: ! existing, studioMetadata: metadata };
}

/**
 * Returns the `?reprint-api` endpoint URL on a remote site for the
 * given normalized site URL.  The reprint-exporter plugin mounts its
 * API on that query-arg marker instead of a REST route so the exporter
 * intercepts requests before WordPress's full bootstrap runs.
 */
export function getReprintApiUrlForSite( siteUrl: string ): string {
	const apiUrl = new URL( siteUrl );
	apiUrl.search = '?reprint-api';
	return apiUrl.toString();
}

function buildFilesSyncArgs(
	metadata: Pick< PullSessionMetadata, 'stateDirectory' | 'rawDirectory' | 'fileOnlyPaths' >,
	apiUrl: string,
	secret: string,
	extraArgs: string[] = []
): string[] {
	return [
		'files-sync',
		apiUrl,
		`--secret=${ secret }`,
		...extraArgs,
		// Carry the same `--only` set as pull-files: files-pull refuses to
		// resume against the shared state dir with a different `--only` (its
		// index is a union keyed by a fingerprint of the prefixes).
		...( metadata.fileOnlyPaths ?? [] ).map( ( onlyPath ) => `--only=${ onlyPath }` ),
		// Per-batch ceiling — one sub-process yields after 30 s and the
		// client reconnects to continue.  Not a total-time budget; a slow
		// or high-latency sync just makes more round-trips.  Kept well
		// under common proxy/LB idle timeouts (~60 s).
		'--max-exec=30',
		'--no-adaptive',
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	];
}

/**
 * Advance the pull to the given stage AND persist the progress file to
 * disk so a crash here resumes from the stage that just finished.  Every
 * phase function calls this once at the end — it's the single seam where
 * in-memory progress becomes durable resume state.
 */
function recordCompletedStage( metadata: PullSessionMetadata, stage: PullStage ): void {
	metadata.stage = stage;
	savePullProgress( metadata );
}

/**
 * Read-modify-write a single site record in `cli.json` under the config
 * lock.  No-op if the record is gone.  The lone seam through which the
 * pull mutates durable site state (origin, runtime link, importComplete,
 * admin credentials), each as a fresh read so concurrent writers don't
 * clobber each other.
 */
async function updateSiteRecord(
	siteId: string,
	apply: ( record: SiteData ) => void
): Promise< void > {
	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const record = cliConfig.sites.find( ( s ) => s.id === siteId );
		if ( record ) {
			apply( record );
			await saveCliConfig( cliConfig );
		}
	} finally {
		await unlockCliConfig();
	}
}

/**
 * Mark the site as having completed a full pull at least once (durable,
 * survives loss of `pull.json`).  Idempotent.
 */
async function markImportComplete( site: SiteData ): Promise< void > {
	if ( site.importComplete ) {
		return;
	}
	site.importComplete = true;
	await updateSiteRecord( site.id, ( record ) => {
		record.importComplete = true;
	} );
}

/**
 * Re-applies the site's stored admin credentials over the running
 * site's admin API (`POST /?studio-admin-api`) — the same endpoint
 * both server runtimes hit on startup.
 *
 * Needed after a re-pull's db-apply: the remote dump contains neither
 * the local admin user nor the `studio_admin_username` option, so
 * rebuilding the database from it breaks `/studio-auto-login` until
 * the credentials are applied again.
 *
 * Returns:
 *   - 'applied'     credentials re-applied on the running server
 *   - 'skipped'     the site record has no credentials to apply
 *   - 'unreachable' the server didn't answer — the caller should
 *                   treat the site as not running and start it
 */
export async function reapplyAdminCredentials(
	site: SiteData
): Promise< 'applied' | 'skipped' | 'unreachable' > {
	const credentials = {
		adminUsername: site.adminUsername,
		adminPassword: site.adminPassword,
		adminEmail: site.adminEmail,
	};
	if ( ! shouldSetAdminCredentials( credentials ) ) {
		return 'skipped';
	}

	let response: Response;
	try {
		response = await fetch( new URL( '/?studio-admin-api', getSiteUrl( site ) ), {
			method: 'POST',
			body: toUrlSearchParams( getSetAdminCredentialsRequestBody( credentials ) ),
			signal: AbortSignal.timeout( 15_000 ),
		} );
	} catch {
		return 'unreachable';
	}

	if ( ! response.ok ) {
		throw new LoggerError(
			sprintf(
				// translators: %d: HTTP status code.
				__( 'Failed to re-apply the admin credentials after the database refresh (HTTP %d).' ),
				response.status
			)
		);
	}

	return 'applied';
}

function printSiteUrls( localUrl: string ): void {
	// Pulled sites always run on the Playground runtime today.
	console.log( __( 'Site URL: ' ), buildAutoLoginUrl( SITE_RUNTIME_PLAYGROUND, localUrl ) );
	console.log(
		__( 'WP Admin: ' ),
		buildAutoLoginUrl(
			SITE_RUNTIME_PLAYGROUND,
			localUrl,
			new URL( '/wp-admin/', localUrl ).toString()
		)
	);
	console.log( '' );
}

function printCompletionMessage( site: SiteData, localUrl: string ): void {
	console.log( '' );
	console.log( `Site "${ site.name }" pulled successfully.` );
	console.log( '' );
	if ( localUrl ) {
		printSiteUrls( localUrl );
	}
}
