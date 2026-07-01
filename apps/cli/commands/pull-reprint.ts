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
import * as fsUtils from '@studio/common/lib/fs-utils';
import { encodePassword } from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
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
	getContentDirFromState,
	getReprintStatePath,
	hasSkippedFiles,
	readReprintState,
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
					verbose
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
 * Where Studio stores the metadata and the raw filesystem structure
 * for each pulled site.
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
 * Version the stored metadata file format to gracefully change it over time.
 */
const PULL_METADATA_VERSION = 1;

/**
 * On-disk resume state for an in-flight pull (`pull.json`).
 *
 * Written by {@link savePullMetadata} at the top of the technical
 * pull directory.  Each field falls into one of three buckets:
 *
 *   - Identity: `version`, `pullKey`, `normalizedUrl`, `siteName` —
 *     fixed for the lifetime of a pull and used to match a rerun
 *     back to its directory.
 *   - Layout: `sitePath`, `technicalSiteDirectory`, `rawDirectory`,
 *     `stateDirectory`, `runtimeDirectory`, `runtimeBlueprintPath` —
 *     derived paths cached so every phase doesn't recompute them.
 *   - Progress: `stage` plus the post-download fields (`siteId`,
 *     `port`, `localUrl`, `remoteSiteUrl`, `tablePrefix`, `secret`)
 *     that individual phases fill in as they complete.
 */
interface PullSessionMetadata {
	version: number;
	pullKey: string;
	normalizedUrl: string;
	siteName: string;
	sitePath: string;
	technicalSiteDirectory: string;
	rawDirectory: string;
	stateDirectory: string;
	runtimeDirectory: string;
	runtimeBlueprintPath: string;
	stage: PullStage;
	/**
	 * True once this pull has reached the 'completed' stage at least once.
	 * A re-run after that point is a delta re-pull: the stage machine is
	 * reset so every phase re-executes against the preserved state
	 * directory.
	 */
	hasCompletedOnce?: boolean;
	siteId?: string;
	port?: number;
	localUrl?: string;
	remoteSiteUrl?: string;
	tablePrefix?: string;
	secret?: string;
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
 *   ensurePort →
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
	verbose = false
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

	const sourceSite = await resolveSourceSite( remoteUrl, remoteSecret, verbose );
	if ( ! sourceSite ) {
		return;
	}

	const { url: sourceSiteUrl } = sourceSite;
	let secret = sourceSite.secret;
	const { created, studioMetadata } = await getPullSessionMetadata( site, sourceSiteUrl );
	const apiUrl = getReprintApiUrlForSite( studioMetadata.normalizedUrl );

	// A previously completed pull re-runs as a delta sync: reset the
	// stage machine so every phase executes again. Reprint does the
	// incremental work against the preserved state directory — files
	// re-sync as a delta (re-index + diff), the database is fully
	// re-downloaded and re-applied (the dump is idempotent, so remote
	// edits, inserts, and deletes all land locally).
	const isRepull = studioMetadata.stage === 'completed';
	if ( isRepull ) {
		studioMetadata.stage = 'initialized';
		studioMetadata.hasCompletedOnce = true;
		savePullMetadata( studioMetadata );

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

	// Create the `~/.studio/pulls/<pull-key>` directory structure for the
	// pull session data.
	fs.mkdirSync( studioMetadata.rawDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.stateDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.runtimeDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.sitePath, { recursive: true } );

	const isResume = ! created || fs.readdirSync( studioMetadata.stateDirectory ).length > 0;
	if ( isRepull ) {
		console.log(
			`Updating "${ studioMetadata.siteName }" from ${ studioMetadata.normalizedUrl } (delta sync)`
		);
		console.log( '' );
	} else if ( isResume ) {
		console.log(
			`Resuming previous pull of "${ studioMetadata.siteName }" from ${ studioMetadata.normalizedUrl }`
		);
		console.log( '' );
	} else {
		console.log( `Pulling "${ studioMetadata.siteName }" from ${ studioMetadata.normalizedUrl }` );
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
		studioMetadata.remoteSiteUrl = preflight.siteurl || studioMetadata.normalizedUrl;
		studioMetadata.tablePrefix = preflight.table_prefix || undefined;
		studioMetadata.secret = secret;
		savePullMetadata( studioMetadata );

		// Allocate the local port before the pull so db-apply (run inside
		// the composite `pull`) can rewrite the remote site URL to the
		// local one the Studio server will serve.
		await ensurePort( studioMetadata );

		// A single `reprint pull` runs the whole pipeline in one PHP-WASM
		// fork: files-pull → db-pull → db-apply → flat-docroot →
		// apply-runtime. reprint owns the stage ordering internally and, on
		// a delta re-pull, resets its own sub-command state via
		// prepare_repull().
		if ( ! hasPullCompletedStage( studioMetadata, 'pulled' ) ) {
			await runFullPull( SITE_RUNTIME_NATIVE_PHP, studioMetadata, apiUrl, secret, verbose );
		}

		// The site record already exists (created via `studio create`); the
		// pull only needs to wire the generated technical directory and
		// runtime Blueprint onto it so `studio start` and the daemon serve
		// the imported runtime rather than the original blank install.
		if ( ! hasPullCompletedStage( studioMetadata, 'site-registered' ) ) {
			logger.reportStart(
				LoggerAction.CREATE_SITE,
				`Linking pulled files to "${ studioMetadata.siteName }"…`
			);
			await linkPulledRuntimeToSite( site, studioMetadata );
			logger.reportSuccess( `Site "${ studioMetadata.siteName }" updated` );
			recordCompletedStage( studioMetadata, 'site-registered' );
			logger.reportKeyValuePair( 'id', site.id );
		}

		// Imported sites' databases come from the remote dump, which lacks
		// the local admin user. Without this, the auto-login mu-plugin can't
		// find an admin user (it falls back to looking for "admin" which
		// doesn't exist in the imported database).
		if ( ! site.adminPassword ) {
			site.adminPassword = encodePassword( crypto.randomBytes( 24 ).toString( 'base64url' ) );
			try {
				await lockCliConfig();
				const cliConfig = await readCliConfig();
				const record = cliConfig.sites.find( ( s ) => s.id === site.id );
				if ( record ) {
					record.adminPassword = site.adminPassword;
					await saveCliConfig( cliConfig );
				}
			} finally {
				await unlockCliConfig();
			}
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
					studioMetadata.localUrl = getSiteUrl( site );
					savePullMetadata( studioMetadata );
					recordCompletedStage( studioMetadata, 'site-started' );
				} else {
					const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
					logger.reportSuccess( __( 'WordPress server started' ) );

					if ( processDesc.status === 'online' ) {
						await updateSiteLatestCliPid( site.id, processDesc.pid );
					}
					studioMetadata.localUrl = getSiteUrl( site );
					savePullMetadata( studioMetadata );
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
			console.log( `Site "${ studioMetadata.siteName }" is ready.` );
			console.log( '' );
			printSiteUrls( studioMetadata.localUrl );
		}

		if ( ! hasPullCompletedStage( studioMetadata, 'completed' ) ) {
			if ( hasSkippedFiles( studioMetadata.stateDirectory ) ) {
				await downloadSkippedFiles(
					getSiteRuntime( site ),
					studioMetadata,
					apiUrl,
					secret,
					verbose
				);
			}

			recordCompletedStage( studioMetadata, 'completed' );
		}

		printCompletionMessage( studioMetadata );
		process.exit( 0 );
	} catch ( error ) {
		const resumeCommand = [
			'studio pull-reprint',
			`--path "${ localPath }"`,
			`--url ${ studioMetadata.normalizedUrl }`,
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

function getMetadataPath( technicalSiteDirectory: string ): string {
	return path.join( technicalSiteDirectory, 'pull.json' );
}

/**
 * Persist the import metadata file (`pull.json`) that tracks the
 * in-flight state of a site pull between runs.  Rerunning `studio
 * pull-reprint` re-reads this file to resume from the last
 * completed Studio-side stage rather than starting over.  Written
 * atomically via a temp file + rename so a crash mid-write leaves
 * the previous snapshot intact.
 *
 * Distinct from reprint's own `.import-state.json` (read/written by
 * {@link readReprintState} in `reprint-state.ts`): that file is
 * reprint.phar's internal cursor for an individual command — what
 * file it was syncing, which byte it stopped at, what the preflight
 * returned.  `pull.json` is Studio's higher-level pipeline state —
 * which of the nine {@link pullStageOrder} stages have finished,
 * plus identity/layout/progress fields the next run needs to find
 * its way back to the same directory.
 *
 * A single pull has one `pull.json` for its lifetime and a
 * rotating `.import-state.json` per reprint sub-command invocation.
 */
function savePullMetadata( metadata: PullSessionMetadata ): void {
	fs.mkdirSync( metadata.technicalSiteDirectory, { recursive: true } );
	const metadataPath = getMetadataPath( metadata.technicalSiteDirectory );
	const tempPath = `${ metadataPath }.tmp`;
	fs.writeFileSync( tempPath, JSON.stringify( metadata, null, 2 ) + '\n' );
	fs.renameSync( tempPath, metadataPath );
}

function readPullMetadata( metadataPath: string ): PullSessionMetadata | null {
	let raw: string;
	try {
		raw = fs.readFileSync( metadataPath, 'utf-8' );
	} catch ( error: unknown ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return null;
		}
		throw error;
	}

	const metadata = JSON.parse( raw ) as PullSessionMetadata;
	if ( metadata.version !== PULL_METADATA_VERSION ) {
		return null;
	}
	return metadata;
}

/**
 * Run reprint's composite `pull` command: the whole site-clone
 * pipeline (preflight → files-pull → db-pull → db-apply →
 * flat-docroot → apply-runtime) in a single child process, with
 * reprint owning the stage ordering and, when the prior pull already
 * completed, resetting its own sub-command state for a delta re-pull
 * via prepare_repull().
 *
 * The SQLite target geometry:
 *   - If preflight exposed the remote `wp-content` (contentDir set),
 *     the database lands under `rawDirectory + contentDir`, an
 *     already-mounted host path that flat-docroot later symlinks into
 *     the flattened site.
 *   - Otherwise it falls back to `sitePath/wp-content`.
 *
 * The flattened site (`--flatten-to`) and runtime output
 * (`--output-dir`) directories are mounted up front so the single
 * fork can write them onto the host filesystem.  `ensurePort` must
 * run first so `--new-site-url` points at the local server.
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

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Pulling site…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		[
			'pull',
			apiUrl,
			`--secret=${ secret }`,
			'--filter=essential-files',
			'--target-engine=sqlite',
			`--target-sqlite-path=${ sqlitePath }`,
			`--new-site-url=${ metadata.localUrl! }`,
			`--flatten-to=${ metadata.sitePath }`,
			`--runtime=${ reprintRuntime }`,
			'--start-runtime=none',
			`--output-dir=${ metadata.runtimeDirectory }`,
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
			'--force',
		],
		( progress ) => logger.reportProgress( progress ),
		{
			progressLabel: __( 'Pulling site' ),
			mounts: [
				{ hostPath: metadata.sitePath, vfsPath: metadata.sitePath },
				{ hostPath: metadata.runtimeDirectory, vfsPath: metadata.runtimeDirectory },
			],
			verboseCommands: verbose,
			runtime,
		}
	);
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
	const isResumingSkipped =
		reprintState?.stage === 'fetch-skipped' && reprintState?.status !== 'complete';

	// Rewrite the reprint state so the next files-sync understands it
	// should download the entries the essential-files pass skipped.  No-op
	// when reprint is already mid-way through that run (its state file
	// encodes the resume cursor; overwriting would break validation) or
	// when no skipped entries exist.
	if ( ! isResumingSkipped && hasSkippedFiles( metadata.stateDirectory ) ) {
		const statePath = getReprintStatePath( metadata.stateDirectory );
		if ( fs.existsSync( statePath ) ) {
			try {
				const currentState = JSON.parse( fs.readFileSync( statePath, 'utf-8' ) ) as Record<
					string,
					unknown
				>;
				fs.writeFileSync(
					statePath,
					JSON.stringify(
						{
							...currentState,
							command: 'files-sync',
							status: 'complete',
							stage: null,
							filter: 'essential-files',
						},
						null,
						2
					) + '\n'
				);
			} catch {
				// Leave reprint state untouched if it cannot be parsed.
			}
		}
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

// 12 hex characters = 48 bits of a SHA-256 hash.  This is used as a
// directory name for the pull's technical files, not for security.
// At 48 bits the birthday-collision threshold is ~2^24 (~16 million)
// imports — far beyond any realistic single-machine usage.
const IMPORT_KEY_HEX_LENGTH = 12;

/**
 * Derives the stable 12-hex-char key Studio uses as the folder name
 * under `~/.studio/pulls/` for a given pull.  It's a SHA-256 of
 * `<normalizedUrl>\n<explicitName or __auto__>`, truncated.
 *
 * The key is what lets a resumed `pull-reprint` find the same
 * technical directory as the previous run: normalize the URL the same
 * way, hash the same inputs, get the same folder back.  The optional
 * `explicitName` is retained for back-compat with the previous
 * URL+name keying; PR 2 re-keys the scratch directory by `siteId`.
 *
 * Not a secret and not collision-resistant in the cryptographic
 * sense — just a deterministic, filesystem-safe slug.
 */
export function getPrivateDirNameForImportSession(
	normalizedUrl: string,
	explicitName?: string
): string {
	return crypto
		.createHash( 'sha256' )
		.update( `${ normalizedUrl }\n${ explicitName || '__auto__' }` )
		.digest( 'hex' )
		.slice( 0, IMPORT_KEY_HEX_LENGTH );
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
 * which `runCommand` resolves separately by `--path`.  Returns the
 * remote `url`/`secret` (plus the matched WordPress.com site + token
 * when applicable).  Handles three input patterns:
 *
 *   1. `--url` + `--secret` — trusted pair, used as-is (self-hosted
 *      sites and arbitrary URLs).
 *   2. `--url` alone — try a previously cached secret from an earlier
 *      run for this URL; fall back to rotating a fresh WP.com secret.
 *   3. No `--url` — among pullable (`syncable`) sites only: if the user
 *      has exactly one, pick it; with several, show an interactive
 *      picker in a TTY (returning `null` if the user cancels) or error
 *      out when run non-interactively. Non-pullable sites (Simple, or
 *      missing hosting features) are surfaced as disabled in the picker.
 */
export async function resolveSourceSite(
	url?: string,
	providedSecret?: string,
	_verbose = false
): Promise< PullSource | null > {
	// When the caller provides an explicit secret, use it directly.
	if ( url && providedSecret ) {
		return { url, secret: providedSecret };
	}

	// When the caller provides a URL, try the HMAC secret Studio cached
	// on the last successful pull for this URL so a resumed run can
	// skip the wp.com rotation round-trip.  If it's stale, preflight
	// will 403 later and fall back to rotating a fresh one.  The cached
	// secret stays URL-keyed for now (origin moves onto SiteData in PR 2).
	if ( url ) {
		const normalizedForLookup = normalizeSiteUrl( url );
		const cachedMetadata = readPullMetadata(
			getMetadataPath(
				path.join( PULLS_ROOT, getPrivateDirNameForImportSession( normalizedForLookup ) )
			)
		);
		if ( cachedMetadata?.secret ) {
			return { url, secret: cachedMetadata.secret };
		}
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
 * Builds (or resumes) the transient pull-session metadata for refreshing
 * an existing Studio `site` from `url`.
 *
 * Local identity — `siteId`, `siteName`, `sitePath`, `port` — is read
 * from the resolved {@link SiteData} rather than invented here; this
 * function only owns the technical-directory layout and the resume
 * `stage`.  The scratch directory is still keyed by a URL hash (the
 * `pullKey`); PR 2 re-keys it by `siteId`.
 */
export async function getPullSessionMetadata( site: SiteData, url: string ) {
	const normalizedUrl = normalizeSiteUrl( url );
	const pullKey = getPrivateDirNameForImportSession( normalizedUrl );
	const technicalSiteDirectory = path.join( PULLS_ROOT, pullKey );
	const metadataPath = getMetadataPath( technicalSiteDirectory );
	const existing = readPullMetadata( metadataPath );

	if ( existing ) {
		return { created: false, studioMetadata: existing };
	}

	const metadata: PullSessionMetadata = {
		version: PULL_METADATA_VERSION,
		pullKey,
		normalizedUrl,
		siteId: site.id,
		siteName: site.name,
		sitePath: site.path,
		port: site.port,
		technicalSiteDirectory,
		rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
		stateDirectory: path.join( technicalSiteDirectory, 'state' ),
		runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
		runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
		stage: 'initialized',
	};

	savePullMetadata( metadata );
	return { created: true, studioMetadata: metadata };
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
	metadata: Pick< PullSessionMetadata, 'stateDirectory' | 'rawDirectory' >,
	apiUrl: string,
	secret: string,
	extraArgs: string[] = []
): string[] {
	return [
		'files-sync',
		apiUrl,
		`--secret=${ secret }`,
		...extraArgs,
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
 * Advance the pull to the given stage AND persist the new metadata
 * to disk so a crash here resumes from the stage that just finished.
 * Every phase function calls this once at the end — it's the single
 * seam where in-memory progress becomes durable resume state.
 */
function recordCompletedStage( metadata: PullSessionMetadata, stage: PullStage ): void {
	metadata.stage = stage;
	savePullMetadata( metadata );
}

/**
 * Picks a free local port for the imported site and records it on the
 * metadata so db-apply can rewrite the remote site URL to the local
 * one the Studio server will listen on.  Skips already-ported imports
 * so resuming a pull keeps the same port (and therefore the same
 * rewritten URLs) as the interrupted run.
 */
async function ensurePort( metadata: PullSessionMetadata ): Promise< void > {
	const cliConfig = await readCliConfig();

	// When a Studio site record already exists for this pull, adopt its
	// identity even if the metadata already carries a port — the record
	// can change between runs (e.g. the site was deleted and re-created
	// and got a different id/port).  db-apply rewrites the database URLs
	// to metadata.localUrl, so a stale port here would rewrite the site
	// to a URL nothing serves.
	const existingSite = cliConfig.sites.find(
		( site ) =>
			( metadata.siteId && site.id === metadata.siteId ) ||
			fsUtils.arePathsEqual( site.path, metadata.sitePath ) ||
			site.technicalSiteDirectory === metadata.technicalSiteDirectory
	);
	if ( existingSite ) {
		if (
			metadata.siteId !== existingSite.id ||
			metadata.port !== existingSite.port ||
			metadata.localUrl !== getSiteUrl( existingSite )
		) {
			metadata.siteId = existingSite.id;
			metadata.port = existingSite.port;
			metadata.localUrl = getSiteUrl( existingSite );
			savePullMetadata( metadata );
		}
		return;
	}

	if ( metadata.port && metadata.localUrl ) {
		return;
	}

	for ( const site of cliConfig.sites ) {
		portFinder.addUnavailablePort( site.port );
	}

	const port = await portFinder.getOpenPort();
	metadata.port = port;
	metadata.localUrl = `http://localhost:${ port }`;
	savePullMetadata( metadata );
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

function printCompletionMessage( metadata: PullSessionMetadata ): void {
	console.log( '' );
	console.log( `Site "${ metadata.siteName }" pulled successfully.` );
	console.log( '' );
	if ( metadata.localUrl ) {
		printSiteUrls( metadata.localUrl );
	}
}

/**
 * Wires the pull's generated technical directory and runtime Blueprint
 * onto the existing Studio site record so `studio start` and the daemon
 * serve the imported runtime instead of the original blank install from
 * `studio create`.  The record itself is never created or removed here —
 * it already exists, identified by `--path`.  Mutates the in-memory
 * `site` to match the persisted record, and holds the CLI config lock
 * for the read-modify-write.
 */
async function linkPulledRuntimeToSite(
	site: SiteData,
	metadata: PullSessionMetadata
): Promise< void > {
	site.technicalSiteDirectory = metadata.technicalSiteDirectory;
	site.runtimeBlueprintPath = metadata.runtimeBlueprintPath;

	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const record = cliConfig.sites.find( ( s ) => s.id === site.id );
		if ( record ) {
			record.technicalSiteDirectory = metadata.technicalSiteDirectory;
			record.runtimeBlueprintPath = metadata.runtimeBlueprintPath;
			await saveCliConfig( cliConfig );
		}
	} finally {
		await unlockCliConfig();
	}
}
