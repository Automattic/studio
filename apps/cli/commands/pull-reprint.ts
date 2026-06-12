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
import { confirm } from '@inquirer/prompts';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import * as fsUtils from '@studio/common/lib/fs-utils';
import { generateNumberedName } from '@studio/common/lib/generate-site-name';
import { encodePassword } from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import { sortSites } from '@studio/common/lib/sort-sites';
import { PullReprintCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import chalk from 'chalk';
import { enableReprintExporter, rotateReprintSecret } from 'cli/lib/api';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteUrl, updateSiteAutoStart, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import {
	type ReprintProcessResult,
	runReprintCommandUntilComplete,
} from 'cli/lib/pull/migration-client';
import {
	getContentDirFromState,
	getReprintStatePath,
	hasSkippedFiles,
	readReprintState,
	shouldRestartFilesSyncIndex,
} from 'cli/lib/pull/reprint-state';
import {
	ensureImportedSiteSqliteReady,
	loadImportedRuntimeStartOptions,
} from 'cli/lib/pull/runtime-start-options';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { buildAutoLoginUrl } from 'cli/lib/site-utils';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { getPrettyPath } from 'cli/lib/utils';
import { startWordPressServer } from 'cli/lib/wordpress-server-manager';
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
					describe: __( 'URL of the remote WordPress site' ),
				} )
				.option( 'secret', {
					type: 'string',
					describe: __( 'Shared HMAC secret configured in the migration plugin' ),
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Local site name' ),
				} )
				.option( 'abort', {
					type: 'boolean',
					describe: __( 'Abort a matching import and remove its local files' ),
					default: false,
				} )
				.option( 'yes', {
					type: 'boolean',
					alias: 'y',
					describe: __( 'Skip the confirmation prompt and create the site without asking' ),
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
					argv.url as string | undefined,
					argv.secret as string | undefined,
					argv.name as string | undefined,
					verbose,
					argv.abort as boolean,
					argv.yes as boolean
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
	'essential-files-complete',
	'flattened',
	'db-downloaded',
	'db-applied',
	'runtime-generated',
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
 *   resolvePullSource →
 *   resolvePullMetadata →
 *   runPreflight (with secret-rotate retry on WP.com) →
 *   downloadEssentialSiteFiles →
 *   refreshFlattenedSiteDirectory →
 *   downloadRemoteDatabase →
 *   ensurePort →
 *   applyDownloadedDatabase →
 *   generateRuntimeConfiguration →
 *   registerSite →
 *   startWordPressServer →
 *   downloadSkippedFiles.
 *
 * Every stage persists its completion to `pull.json` before moving
 * on (see {@link recordCompletedStage}), so a crash anywhere in the
 * pipeline resumes at the next stage on re-run.  `--abort` detours to
 * {@link abortPull} instead.
 */
export async function runCommand(
	userProvidedUrl?: string,
	userProvidedSecret?: string,
	userProvidedName?: string,
	verbose = false,
	abort = false,
	yes = false
): Promise< void > {
	if ( abort ) {
		if ( ! userProvidedUrl ) {
			throw new LoggerError(
				__( 'Provide `--url` to abort a pull and clean up its local state.' )
			);
		}
		await abortPull( userProvidedUrl, userProvidedName, verbose );
		return;
	}

	const sourceSite = await resolveSourceSite(
		userProvidedUrl,
		userProvidedSecret,
		userProvidedName,
		verbose
	);
	if ( ! sourceSite ) {
		return;
	}

	const { url: sourceSiteUrl } = sourceSite;
	let secret = sourceSite.secret;
	const { created, studioMetadata } = await getPullSessionMetadata(
		sourceSiteUrl,
		userProvidedName
	);
	const apiUrl = getReprintApiUrlForSite( studioMetadata.normalizedUrl );

	// Refuse to clobber an existing non-empty site directory before the
	// flatten stage.  Once flattened, the directory legitimately holds
	// reprint's output; before that, anything there is user data.
	if ( ! hasPullCompletedStage( studioMetadata, 'flattened' ) ) {
		if (
			( await fsUtils.pathExists( studioMetadata.sitePath ) ) &&
			! ( await fsUtils.isEmptyDir( studioMetadata.sitePath ) )
		) {
			throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
		}
	}

	// A fresh pull silently creates a brand-new local site (in the ~/Studio folder).
	// Confirm first so the user understands a new site will be created.
	// Only ask on a fresh, interactive run when `--yes` was not passed;
	// resumes already made this choice and non-interactive callers
	// (CI, Desktop) must keep the current non-prompting behavior.
	const shouldConfirmSiteCreation = created && !! process.stdin.isTTY && ! yes;
	if ( shouldConfirmSiteCreation ) {
		const shouldContinue = await confirm( {
			message: sprintf(
				// translators: 1: local site name, 2: local site path, 3: remote source URL.
				__( 'This will create a new local site "%1$s" at %2$s, pulling from %3$s. Continue?' ),
				studioMetadata.siteName,
				getPrettyPath( studioMetadata.sitePath ),
				studioMetadata.normalizedUrl
			),
			default: true,
		} );
		if ( ! shouldContinue ) {
			// `getPullSessionMetadata` just wrote `pull.json` here. If we leave
			// it, the next run reads it back and returns `created: false`,
			// silently resuming this declined pull instead of re-prompting.
			fs.rmSync( studioMetadata.technicalSiteDirectory, { recursive: true, force: true } );
			console.log( __( 'Cancelled.' ) );
			return;
		}
	}

	// Create the `~/.studio/pulls/<pull-key>` directory structure for the
	// pull session data.
	fs.mkdirSync( studioMetadata.rawDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.stateDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.runtimeDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.sitePath, { recursive: true } );

	if ( studioMetadata.stage === 'completed' ) {
		printCompletionMessage( studioMetadata );
		process.exit( 0 );
	}

	const isResume = ! created || fs.readdirSync( studioMetadata.stateDirectory ).length > 0;
	if ( isResume ) {
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
			preflight = await runPreflight( studioMetadata, apiUrl, secret, verbose );
		} catch ( preflightError ) {
			// The stored secret may have expired.  Resolve the WP.com site
			// (loading the site list only now, if we haven't already) and
			// rotate the secret before retrying the preflight.
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
			preflight = await runPreflight( studioMetadata, apiUrl, secret, verbose );
		}
		studioMetadata.remoteSiteUrl = preflight.siteurl || studioMetadata.normalizedUrl;
		studioMetadata.tablePrefix = preflight.table_prefix || undefined;
		studioMetadata.secret = secret;
		savePullMetadata( studioMetadata );

		if ( ! hasPullCompletedStage( studioMetadata, 'essential-files-complete' ) ) {
			await downloadEssentialSiteFiles( studioMetadata, apiUrl, secret, verbose );
		}

		if ( ! hasPullCompletedStage( studioMetadata, 'flattened' ) ) {
			logger.reportStart( LoggerAction.CREATE_SITE, __( 'Preparing site directory…' ) );
			await refreshFlattenedSiteDirectory( studioMetadata, verbose );
			logger.reportSuccess( __( 'Site directory prepared' ) );
			recordCompletedStage( studioMetadata, 'flattened' );
		}

		if ( ! hasPullCompletedStage( studioMetadata, 'db-downloaded' ) ) {
			await downloadRemoteDatabase( studioMetadata, apiUrl, secret, verbose );
		}

		await ensurePort( studioMetadata );

		if ( ! hasPullCompletedStage( studioMetadata, 'db-applied' ) ) {
			await applyDownloadedDatabase( studioMetadata, secret, verbose );
		}

		if ( ! hasPullCompletedStage( studioMetadata, 'runtime-generated' ) ) {
			await generateRuntimeConfiguration( studioMetadata, verbose );
		}

		let createdSiteRecord = false;
		if ( ! hasPullCompletedStage( studioMetadata, 'site-registered' ) ) {
			logger.reportStart(
				LoggerAction.CREATE_SITE,
				`Creating site "${ studioMetadata.siteName }"…`
			);
			const result = await registerSite( studioMetadata );
			createdSiteRecord = result.created;
			logger.reportSuccess( `Site "${ studioMetadata.siteName }" created` );
			recordCompletedStage( studioMetadata, 'site-registered' );
			logger.reportKeyValuePair( 'id', result.site.id );

			if ( createdSiteRecord ) {
				await emitCliEvent( { event: SITE_EVENTS.CREATED, data: { siteId: result.site.id } } );
			}
		}

		const site = ( await findExistingSite( studioMetadata ) )!;

		// Imported sites don't go through the normal create flow that sets
		// admin credentials. Without this, the auto-login mu-plugin can't
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
			await ensureImportedSiteSqliteReady( studioMetadata.runtimeBlueprintPath );
			const runtimeStartOptions = await loadImportedRuntimeStartOptions(
				studioMetadata.runtimeBlueprintPath
			);

			// Persist the computed start options so `studio site start` and
			// the daemon can re-read them without recomputing (which spins
			// up PHP WASM to extract runtime.php constants).
			const startOptionsPath = path.join( studioMetadata.runtimeDirectory, 'start-options.json' );
			fs.writeFileSync( startOptionsPath, JSON.stringify( runtimeStartOptions, null, 2 ) + '\n' );

			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );

			try {
				await connectToDaemon();
				const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
				logger.reportSuccess( __( 'WordPress server started' ) );

				if ( processDesc.status === 'online' ) {
					await updateSiteLatestCliPid( site.id, processDesc.pid );
				}
				await updateSiteAutoStart( site.id, true );
				studioMetadata.localUrl = getSiteUrl( site );
				savePullMetadata( studioMetadata );
				recordCompletedStage( studioMetadata, 'site-started' );
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
				await downloadSkippedFiles( studioMetadata, apiUrl, secret, verbose );
			}

			recordCompletedStage( studioMetadata, 'completed' );
		}

		printCompletionMessage( studioMetadata );
		process.exit( 0 );
	} catch ( error ) {
		const resumeCommand = [ 'studio pull-reprint', `--url ${ studioMetadata.normalizedUrl }` ];
		if ( userProvidedSecret ) {
			resumeCommand.push( '--secret <secret>' );
		}
		if ( userProvidedName ) {
			resumeCommand.push( `--name "${ userProvidedName }"` );
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
 * `--abort` entry point: tear down the local state for a URL's
 * in-flight pull.  Trashes the flattened site and the technical
 * pull directory (state, raw, runtime).  Only allowed while the
 * pull is still in progress — once it reaches `completed`, the
 * user must use `studio site delete` instead (which also cleans up
 * the CLI config record, daemon auto-start, and preview snapshots).
 */
async function abortPull( url: string, providedName?: string, verbose = false ): Promise< void > {
	const normalizedUrl = normalizeSiteUrl( url );
	const pullKey = getPrivateDirNameForImportSession( normalizedUrl, providedName );
	const technicalSiteDirectory = path.join( PULLS_ROOT, pullKey );
	const metadata = readPullMetadata( getMetadataPath( technicalSiteDirectory ) );

	if ( ! metadata ) {
		throw new LoggerError(
			__( 'No matching pull found was found for that URL. Nothing to abort.' )
		);
	}

	if ( metadata.stage === 'completed' ) {
		throw new LoggerError(
			__( 'This pull has already completed. Use `studio site delete` to remove the site.' )
		);
	}

	logger.reportStart(
		LoggerAction.ABORT_IMPORT,
		__( 'Aborting pull and cleaning up local files…' )
	);

	const deleteTargets = [ metadata.sitePath, metadata.technicalSiteDirectory ].filter(
		( value ): value is string => typeof value === 'string' && fs.existsSync( value )
	);
	if ( deleteTargets.length > 0 ) {
		reportVerboseCommand( verbose, 'trash', deleteTargets );
		const trash = ( await import( 'trash' ) ).default;
		await trash( deleteTargets );
	}
	logger.reportSuccess( __( 'Pull aborted and local files removed' ) );
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

function reportVerboseCommand( verbose: boolean, command: string, args: string[] = [] ): void {
	if ( ! verbose ) {
		return;
	}

	console.error( `[command] ${ [ command, ...args ].join( ' ' ) }` );
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
 * Apply the downloaded SQL dump into an SQLite database that Studio
 * will mount as the imported site's `wp-content/database/.ht.sqlite`.
 *
 * Mount strategy depends on whether preflight told us where the
 * remote site kept its `wp-content`:
 *   - If it did (contentDir set), reprint writes the SQLite file under
 *     `rawDirectory + contentDir`, which is already a mounted host path,
 *     so no extra mount is needed.
 *   - If not, we write into `sitePath/wp-content` directly and mount
 *     that host path into the PHP WASM runtime so reprint can see it.
 *
 * Advances the pull stage to 'db-applied' on success; thrown errors
 * propagate up to the pull orchestrator for a user-facing abort.
 */
export async function applyDownloadedDatabase(
	metadata: PullSessionMetadata,
	secret: string,
	verbose: boolean
): Promise< void > {
	logger.reportStart( LoggerAction.IMPORT_SQL, __( 'Applying database…' ) );
	const contentDir = getContentDirFromState( metadata.stateDirectory );
	const sqlitePath = contentDir
		? `${ metadata.rawDirectory }${ contentDir }/database/.ht.sqlite`
		: `${ metadata.sitePath }/wp-content/database/.ht.sqlite`;
	const dbApplyMounts = contentDir
		? []
		: [ { hostPath: metadata.sitePath, vfsPath: metadata.sitePath } ];
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		[
			'db-apply',
			getReprintApiUrlForSite( metadata.normalizedUrl ),
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
			'--target-engine=sqlite',
			`--target-sqlite-path=${ sqlitePath }`,
			`--new-site-url=${ metadata.localUrl! }`,
			`--secret=${ secret }`,
			'--no-adaptive',
		],
		( progress ) => logger.reportProgress( progress ),
		{
			progressLabel: __( 'Applying database' ),
			mounts: dbApplyMounts,
			verboseCommands: verbose,
		}
	);
	logger.reportSuccess( __( 'Database applied' ) );
	recordCompletedStage( metadata, 'db-applied' );
}

/**
 * Fetch the minimum set of files needed to produce a usable flattened
 * site directory: wp-config.php, wp-includes, active plugins/themes,
 * uploads.  Heavier wp-content payload (unused plugins, dev caches)
 * is deferred to {@link downloadSkippedFiles} so the site becomes
 * runnable sooner.
 *
 * Advances the pull stage to 'essential-files-complete'.
 */
export async function downloadEssentialSiteFiles(
	metadata: PullSessionMetadata,
	apiUrl: string,
	secret: string,
	verbose: boolean
): Promise< void > {
	// When reprint crashed mid-indexing on a previous run without
	// persisting a cursor, a plain files-sync would try to resume from
	// a cursor that doesn't exist.  Clear that state via
	// `files-sync --abort` so the real sync below starts fresh.
	if ( shouldRestartFilesSyncIndex( metadata.stateDirectory ) ) {
		logger.reportWarning(
			__(
				'Restarting remote file indexing before resume because the previous run did not save a resumable cursor.'
			)
		);
		await runReprintCommandUntilComplete(
			metadata.stateDirectory,
			metadata.rawDirectory,
			buildFilesSyncArgs( metadata, apiUrl, secret, [ '--abort' ] ),
			undefined,
			{
				verboseCommands: verbose,
			}
		);
		logger.reportSuccess( __( 'Interrupted file indexing state cleared' ) );
	}

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Downloading site files…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		buildFilesSyncArgs( metadata, apiUrl, secret, [
			'--filter=essential-files',
			'--follow-symlinks',
		] ),
		( progress ) => logger.reportProgress( progress ),
		{
			progressLabel: 'Downloading files',
			verboseCommands: verbose,
		}
	);
	logger.reportSuccess( __( 'Files downloaded' ) );
	recordCompletedStage( metadata, 'essential-files-complete' );
}

/**
 * Stream the remote database into `stateDirectory/db.sql` via reprint's
 * `db-sync` command.  We download-first-then-apply (rather than piping
 * straight into sqlite) so a crash during apply can resume without
 * re-fetching the dump.
 *
 * Advances the pull stage to 'db-downloaded'.
 */
export async function downloadRemoteDatabase(
	metadata: PullSessionMetadata,
	apiUrl: string,
	secret: string,
	verbose: boolean
): Promise< void > {
	logger.reportStart( LoggerAction.DOWNLOAD_SQL, __( 'Downloading database…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		[
			'db-sync',
			apiUrl,
			`--secret=${ secret }`,
			'--sql-output=file',
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
		],
		( progress ) => logger.reportProgress( progress ),
		{
			progressLabel: __( 'Downloading database' ),
			verboseCommands: verbose,
		}
	);
	logger.reportSuccess( __( 'Database downloaded' ) );
	recordCompletedStage( metadata, 'db-downloaded' );
}

/**
 * Produce the Playground CLI start script + runtime blueprint that
 * Studio uses to boot the imported site.  reprint reads the flattened
 * site layout and preflight output, and emits a ready-to-run runtime
 * under `runtimeDirectory`.  Both directories are mounted into WASM
 * so the runtime output lands on the host filesystem.
 *
 * Advances the pull stage to 'runtime-generated'.
 */
export async function generateRuntimeConfiguration(
	metadata: PullSessionMetadata,
	verbose: boolean
): Promise< void > {
	logger.reportStart( LoggerAction.URL_REWRITE, __( 'Generating runtime configuration…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		[
			'apply-runtime',
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--flat-document-root=${ metadata.sitePath }`,
			`--output-dir=${ metadata.runtimeDirectory }`,
			'--runtime=playground-cli',
		],
		undefined,
		{
			mounts: [
				{ hostPath: metadata.sitePath, vfsPath: metadata.sitePath },
				{ hostPath: metadata.runtimeDirectory, vfsPath: metadata.runtimeDirectory },
			],
			verboseCommands: verbose,
		}
	);
	logger.reportSuccess( __( 'Runtime configuration generated' ) );
	recordCompletedStage( metadata, 'runtime-generated' );
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

export function inferSiteNameFromUrl( url: string ): string {
	return new URL( normalizeSiteUrl( url ) ).hostname;
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
 * way, hash the same inputs, get the same folder back.  `--name`
 * participates so two imports of the same URL under different names
 * get different folders rather than clobbering each other.
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
 * Turns the CLI arguments into a `ResolvedImportSource` the pull
 * pipeline can act on.  Handles three input patterns:
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
	providedName?: string,
	_verbose = false
): Promise< PullSource | null > {
	// When the caller provides an explicit secret, use it directly.
	if ( url && providedSecret ) {
		return { url, secret: providedSecret };
	}

	// When the caller provides a URL, try the HMAC secret Studio cached
	// on the last successful pull for this URL so a resumed run can
	// skip the wp.com rotation round-trip.  If it's stale, preflight
	// will 403 later and fall back to rotating a fresh one.
	if ( url ) {
		const normalizedForLookup = normalizeSiteUrl( url );
		const cachedMetadata = readPullMetadata(
			getMetadataPath(
				path.join(
					PULLS_ROOT,
					getPrivateDirNameForImportSession( normalizedForLookup, providedName )
				)
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

export async function getPullSessionMetadata( url: string, explicitName?: string ) {
	const normalizedUrl = normalizeSiteUrl( url );
	const pullKey = getPrivateDirNameForImportSession( normalizedUrl, explicitName );
	const technicalSiteDirectory = path.join( PULLS_ROOT, pullKey );
	const metadataPath = getMetadataPath( technicalSiteDirectory );
	const existing = readPullMetadata( metadataPath );

	if ( existing ) {
		return { created: false, studioMetadata: existing };
	}

	// Pick the Studio-local site name: use --name verbatim if given,
	// otherwise derive from the remote host and disambiguate against
	// existing Studio sites and on-disk directories with a numeric
	// suffix.  The name refers to the local site we're about to
	// create, not the remote source site.
	let siteName: string;
	if ( explicitName ) {
		siteName = explicitName;
	} else {
		const cliConfig = await readCliConfig();
		const baseName = inferSiteNameFromUrl( normalizedUrl );
		siteName = await generateNumberedName(
			baseName,
			cliConfig.sites.map( ( site ) => site.name ),
			path.dirname( getDefaultSitePath( baseName ) )
		);
	}
	const sitePath = getDefaultSitePath( siteName );
	if ( ( await fsUtils.pathExists( sitePath ) ) && ! ( await fsUtils.isEmptyDir( sitePath ) ) ) {
		throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
	}
	const metadata: PullSessionMetadata = {
		version: PULL_METADATA_VERSION,
		pullKey,
		normalizedUrl,
		siteName,
		sitePath,
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
	if ( metadata.port && metadata.localUrl ) {
		return;
	}

	const cliConfig = await readCliConfig();
	for ( const site of cliConfig.sites ) {
		portFinder.addUnavailablePort( site.port );
	}

	const existingSite = cliConfig.sites.find(
		( site ) =>
			( metadata.siteId && site.id === metadata.siteId ) ||
			fsUtils.arePathsEqual( site.path, metadata.sitePath ) ||
			site.technicalSiteDirectory === metadata.technicalSiteDirectory
	);

	const port = existingSite?.port ?? ( await portFinder.getOpenPort() );
	metadata.port = port;
	metadata.localUrl = existingSite ? getSiteUrl( existingSite ) : `http://localhost:${ port }`;
	savePullMetadata( metadata );
}

/**
 * Runs reprint's `flat-document-root` to produce the flattened site
 * directory (symlinks + merged wp-content layout) from the raw tree.
 */
async function refreshFlattenedSiteDirectory(
	metadata: Pick<
		PullSessionMetadata,
		'stateDirectory' | 'rawDirectory' | 'sitePath' | 'runtimeBlueprintPath' | 'normalizedUrl'
	>,
	verbose: boolean
): Promise< void > {
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		[
			'flat-document-root',
			getReprintApiUrlForSite( metadata.normalizedUrl ),
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
			`--flatten-to=${ metadata.sitePath }`,
		],
		undefined,
		{
			mounts: [ { hostPath: metadata.sitePath, vfsPath: metadata.sitePath } ],
			verboseCommands: verbose,
		}
	);
}

async function findExistingSite( metadata: PullSessionMetadata ): Promise< SiteData | undefined > {
	const cliConfig = await readCliConfig();
	return cliConfig.sites.find(
		( site ) =>
			( metadata.siteId && site.id === metadata.siteId ) ||
			fsUtils.arePathsEqual( site.path, metadata.sitePath ) ||
			site.technicalSiteDirectory === metadata.technicalSiteDirectory
	);
}

function printSiteUrls( localUrl: string ): void {
	console.log( __( 'Site URL: ' ), buildAutoLoginUrl( localUrl ) );
	console.log(
		__( 'WP Admin: ' ),
		buildAutoLoginUrl( localUrl, new URL( '/wp-admin/', localUrl ).toString() )
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
 * Either finds the Studio site record this import is already wired
 * up to, or creates a new one and writes it into the CLI config.
 * New-record creation holds the CLI config lock for the duration so
 * two parallel `pull-reprint` runs can't both insert a record for
 * the same directory.  Returns `created: true` only on the create
 * path so the caller can emit a one-shot CREATED event.
 */
async function registerSite(
	metadata: PullSessionMetadata
): Promise< { created: boolean; site: SiteData } > {
	const existingSite = await findExistingSite( metadata );
	if ( existingSite ) {
		return { created: false, site: existingSite };
	}

	await ensurePort( metadata );

	const siteId = metadata.siteId || crypto.randomUUID();
	const siteDetails: SiteData = {
		id: siteId,
		name: metadata.siteName,
		path: metadata.sitePath,
		port: metadata.port!,
		phpVersion: DEFAULT_PHP_VERSION,
		running: false,
		isWpAutoUpdating: true,
		enableHttps: false,
		technicalSiteDirectory: metadata.technicalSiteDirectory,
		runtimeBlueprintPath: metadata.runtimeBlueprintPath,
	};

	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const existingByPath = cliConfig.sites.find(
			( site ) =>
				fsUtils.arePathsEqual( site.path, metadata.sitePath ) ||
				site.technicalSiteDirectory === metadata.technicalSiteDirectory
		);

		if ( existingByPath ) {
			metadata.siteId = existingByPath.id;
			metadata.port = existingByPath.port;
			metadata.localUrl = getSiteUrl( existingByPath );
			savePullMetadata( metadata );
			return { created: false, site: existingByPath };
		}

		cliConfig.sites.push( siteDetails );
		sortSites( cliConfig.sites );
		await saveCliConfig( cliConfig );
	} finally {
		await unlockCliConfig();
	}

	metadata.siteId = siteId;
	savePullMetadata( metadata );
	return { created: true, site: siteDetails };
}
