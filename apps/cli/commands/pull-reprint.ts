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
import {
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	SiteRuntime,
	getSiteRuntime,
} from '@studio/common/lib/site-runtime';
import { sortSites } from '@studio/common/lib/sort-sites';
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
import {
	clearSiteLatestCliPid,
	findSiteByFolder,
	getSiteUrl,
	updateSiteLatestCliPid,
} from 'cli/lib/cli-config/sites';
import {
	connectToDaemon,
	disconnectFromDaemon,
	emitCliEvent,
	isProcessRunning,
} from 'cli/lib/daemon-client';
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
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { buildAutoLoginUrl } from 'cli/lib/site-utils';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { getPrettyPath } from 'cli/lib/utils';
import {
	getProcessName,
	isServerRunning,
	StartServerOptions,
	startWordPressServer,
	stopWordPressServer,
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
					argv.yes as boolean,
					argv.path as string | undefined,
					pathFlagWasPassed()
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
 * Tells whether the user actually typed `--path` on the command line.
 *
 * The global `--path` option (see `apps/cli/index.ts`) is declared with
 * `default: process.cwd()`, so yargs' parsed `argv.path` is *always* a string —
 * either the value the user passed or the resolved current directory. That
 * means `argv.path` alone can't distinguish "user passed `--path`" from
 * "defaulted to cwd".
 *
 * pull-reprint needs that distinction because its default differs from the
 * global one: with an explicit `--path` it targets that location (overwrite the
 * site there, or create at that path); without it, it creates under
 * `~/Studio/<name>` — not cwd. So we scan the raw `process.argv` tokens (the
 * unparsed array, distinct from yargs' `argv` object) for an explicit
 * `--path` / `--path=…`.
 */
function pathFlagWasPassed(): boolean {
	return process.argv.slice( 2 ).some( ( arg ) => arg === '--path' || arg.startsWith( '--path=' ) );
}

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
	 * reset so every phase re-executes, and the non-empty site-directory
	 * guard is skipped (the directory legitimately holds the previous
	 * pull's output).
	 */
	hasCompletedOnce?: boolean;
	/**
	 * True when this session overwrites a pre-existing Studio site (an explicit
	 * `--path`, or the cwd, that resolved to a registered site).  The site
	 * directory and config record are not ours to delete, so `--abort` only
	 * tears down the technical directory in that case — never the site itself.
	 */
	isOverwrite?: boolean;
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
 *   ensurePort →
 *   runFullPull (one `reprint pull`: files-pull → db-pull → db-apply →
 *     flat-docroot → apply-runtime) →
 *   registerSite →
 *   startWordPressServer →
 *   downloadSkippedFiles.
 *
 * Each Studio stage persists to `pull.json` (see {@link
 * recordCompletedStage}), so a crash resumes at the next stage; within
 * the pull, reprint resumes its own pipeline from its last completed
 * sub-stage.  `--abort` detours to {@link abortPull} instead.
 *
 * Re-running after a pull reached 'completed' performs a delta
 * re-pull: Studio's stage machine resets to 'initialized' and reprint
 * resets its own sub-command state via prepare_repull().  Each phase is
 * incremental — files re-sync as a delta (re-index + diff), the
 * database is fully re-downloaded and re-applied (the dump is
 * idempotent, so edits, inserts, and deletes all propagate).
 */
export async function runCommand(
	userProvidedUrl?: string,
	userProvidedSecret?: string,
	userProvidedName?: string,
	verbose = false,
	abort = false,
	yes = false,
	sitePath?: string,
	pathWasExplicit = false
): Promise< void > {
	if ( abort ) {
		if ( ! userProvidedUrl ) {
			throw new LoggerError(
				__( 'Provide `--url` to abort a pull and clean up its local state.' )
			);
		}
		await abortPull( userProvidedUrl, userProvidedName, sitePath, pathWasExplicit, verbose );
		return;
	}

	// The resolved path (explicit `--path`, or the current directory by
	// default) decides the local site:
	//   - if a Studio site is already registered there → overwrite it;
	//   - else if `--path` was given explicitly → create the new site there;
	//   - else → create under the default ~/Studio/<name>.
	const targetSite = sitePath ? await findSiteByFolder( sitePath ) : undefined;
	const isOverwrite = !! targetSite;
	const explicitSitePath = pathWasExplicit ? sitePath : undefined;

	const sourceSite = await resolveSourceSite(
		userProvidedUrl,
		userProvidedSecret,
		userProvidedName,
		verbose,
		targetSite,
		explicitSitePath
	);
	if ( ! sourceSite ) {
		return;
	}

	const { url: sourceSiteUrl } = sourceSite;
	let secret = sourceSite.secret;

	const { created, studioMetadata } = await getPullSessionMetadata(
		sourceSiteUrl,
		userProvidedName,
		targetSite,
		explicitSitePath
	);
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

	// In create mode, refuse to clobber an existing non-empty site directory
	// before the pull stage.  Once pulled, the directory legitimately holds
	// reprint's output; before that, anything there is user data.  Overwrite
	// mode (`--path`) intentionally targets an existing site and clears it
	// after confirmation, and a re-pull (hasCompletedOnce) holds the previous
	// pull's output — both skip this guard.
	if (
		! isOverwrite &&
		! studioMetadata.hasCompletedOnce &&
		! hasPullCompletedStage( studioMetadata, 'pulled' )
	) {
		if (
			( await fsUtils.pathExists( studioMetadata.sitePath ) ) &&
			! ( await fsUtils.isEmptyDir( studioMetadata.sitePath ) )
		) {
			throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
		}
	}

	// A fresh pull either creates a brand-new local site or overwrites the one
	// targeted by `--path`.  Confirm first so the user understands what will
	// happen.  Only ask on a fresh, interactive run when `--yes` was not
	// passed; resumes already made this choice and non-interactive callers
	// (CI, Desktop) must keep the current non-prompting behavior.
	const shouldConfirm = created && !! process.stdin.isTTY && ! yes;
	if ( shouldConfirm ) {
		let message: string;
		if ( isOverwrite ) {
			message = sprintf(
				// translators: 1: local site name, 2: local site path, 3: remote source URL.
				__(
					'This will overwrite the local site "%1$s" at %2$s with content pulled from %3$s. Continue?'
				),
				studioMetadata.siteName,
				getPrettyPath( studioMetadata.sitePath ),
				studioMetadata.normalizedUrl
			);
		} else {
			message = sprintf(
				// translators: 1: local site name, 2: local site path, 3: remote source URL.
				__( 'This will create a new local site "%1$s" at %2$s, pulling from %3$s. Continue?' ),
				studioMetadata.siteName,
				getPrettyPath( studioMetadata.sitePath ),
				studioMetadata.normalizedUrl
			);
		}
		const shouldContinue = await confirm( { message, default: true } );
		if ( ! shouldContinue ) {
			// `getPullSessionMetadata` just wrote `pull.json` here. If we leave
			// it, the next run reads it back and returns `created: false`,
			// silently resuming this declined pull instead of re-prompting. This
			// only removes the technical/scratch dir, never the targeted site's
			// own files.
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
			// Overwrite mode: after preflight has proved the remote is reachable,
			// stop the targeted site and clear its files so reprint flattens into
			// a clean directory (mirrors `studio pull`).
			if ( isOverwrite ) {
				await prepareTargetSiteForOverwrite( studioMetadata );
				fs.mkdirSync( studioMetadata.sitePath, { recursive: true } );
			}
			await runFullPull( SITE_RUNTIME_NATIVE_PHP, studioMetadata, apiUrl, secret, verbose );
		}

		let createdSiteRecord = false;
		if ( ! hasPullCompletedStage( studioMetadata, 'site-registered' ) ) {
			logger.reportStart(
				LoggerAction.CREATE_SITE,
				isOverwrite
					? `Updating site "${ studioMetadata.siteName }"…`
					: `Creating site "${ studioMetadata.siteName }"…`
			);
			const result = await registerSite( studioMetadata );
			createdSiteRecord = result.created;
			logger.reportSuccess(
				isOverwrite
					? `Site "${ studioMetadata.siteName }" updated`
					: `Site "${ studioMetadata.siteName }" created`
			);
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
		const resumeCommand = [ 'studio pull-reprint', `--url ${ studioMetadata.normalizedUrl }` ];
		if ( userProvidedSecret ) {
			resumeCommand.push( '--secret <secret>' );
		}
		if ( userProvidedName ) {
			resumeCommand.push( `--name "${ userProvidedName }"` );
		}
		// An explicit `--path` selects (and, for an existing site, overwrites) the
		// target, and keys the session directory. Omitting it on resume would key a
		// different default session and pull elsewhere, so echo it back verbatim.
		if ( pathWasExplicit && sitePath ) {
			resumeCommand.push( `--path "${ sitePath }"` );
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
 * `--abort` entry point: tear down the local state for a URL's
 * in-flight pull.  Trashes the flattened site and the technical
 * pull directory (state, raw, runtime).  Only allowed while the
 * pull is still in progress — once it reaches `completed`, the
 * user must use `studio site delete` instead (which also cleans up
 * the CLI config record, daemon auto-start, and preview snapshots).
 *
 * The session is found by the same key {@link getPullSessionMetadata}
 * created it with, so `--abort` must be passed the same target inputs
 * (`--path`, `--name`) as the original pull.  For an overwrite session
 * the site directory and config record belong to a pre-existing Studio
 * site, so we only remove the technical directory — never the site.
 */
export async function abortPull(
	url: string,
	providedName: string | undefined,
	sitePath: string | undefined,
	pathWasExplicit: boolean,
	verbose = false
): Promise< void > {
	const normalizedUrl = normalizeSiteUrl( url );
	const targetSite = sitePath ? await findSiteByFolder( sitePath ) : undefined;
	const explicitSitePath = pathWasExplicit ? sitePath : undefined;

	const seeds = getPullSessionKeySeeds( {
		targetSite,
		explicitSitePath,
		explicitName: providedName,
	} );
	let metadata: PullSessionMetadata | null = null;
	for ( const seed of seeds ) {
		const dir = path.join( PULLS_ROOT, getPrivateDirNameForImportSession( normalizedUrl, seed ) );
		metadata = readPullMetadata( getMetadataPath( dir ) );
		if ( metadata ) {
			break;
		}
	}

	if ( ! metadata ) {
		throw new LoggerError(
			__( 'No matching pull found was found for that URL. Nothing to abort.' )
		);
	}

	if ( metadata.stage === 'completed' ) {
		throw new LoggerError(
			__( 'This pull has already completed. Use `studio delete` to remove the site.' )
		);
	}

	logger.reportStart(
		LoggerAction.ABORT_IMPORT,
		__( 'Aborting pull and cleaning up local files…' )
	);

	// An overwrite targets a pre-existing Studio site; the directory and config
	// record are not ours to delete (the original content is already gone, but
	// removing the registered site is `studio site delete`'s job). Only clean up
	// the technical directory. A create owns its site directory, so trash both.
	const deleteTargets = (
		metadata.isOverwrite
			? [ metadata.technicalSiteDirectory ]
			: [ metadata.sitePath, metadata.technicalSiteDirectory ]
	).filter( ( value ): value is string => typeof value === 'string' && fs.existsSync( value ) );
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
	_verbose = false,
	targetSite?: SiteData,
	explicitSitePath?: string
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
		const seeds = getPullSessionKeySeeds( {
			targetSite,
			explicitSitePath,
			explicitName: providedName,
		} );
		for ( const seed of seeds ) {
			const cachedMetadata = readPullMetadata(
				getMetadataPath(
					path.join( PULLS_ROOT, getPrivateDirNameForImportSession( normalizedForLookup, seed ) )
				)
			);
			if ( cachedMetadata?.secret ) {
				return { url, secret: cachedMetadata.secret };
			}
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
 * Derives the preferred disambiguator that keys a pull session's technical
 * directory (under `~/.studio/pulls/`).
 *
 * An explicit `--path` wins over a discovered site so the key stays put across
 * the create→register transition: before the first pull there's no site record
 * yet (we only know the path), and after it completes the path resolves to a
 * freshly registered site — keying by the path both times keeps re-runs (and
 * delta re-pulls) on the same session instead of forking a second directory.
 * A site discovered at the resolved path *without* an explicit `--path` (e.g.
 * the cwd) keys by its id; everything else falls back to the optional `--name`.
 */
function getPullSessionKeySeed( {
	targetSite,
	explicitSitePath,
	explicitName,
}: {
	targetSite?: SiteData;
	explicitSitePath?: string;
	explicitName?: string;
} ): string | undefined {
	if ( explicitSitePath ) {
		return `path:${ explicitSitePath }`;
	}
	if ( targetSite ) {
		return `site:${ targetSite.id }`;
	}
	return explicitName;
}

function getPullSessionKeySeeds( {
	targetSite,
	explicitSitePath,
	explicitName,
}: {
	targetSite?: SiteData;
	explicitSitePath?: string;
	explicitName?: string;
} ): Array< string | undefined > {
	const seeds: Array< string | undefined > = [
		getPullSessionKeySeed( { targetSite, explicitSitePath, explicitName } ),
	];

	if ( targetSite && explicitSitePath ) {
		seeds.push( getPullSessionKeySeed( { targetSite, explicitName } ) );
	} else if ( targetSite ) {
		seeds.push(
			getPullSessionKeySeed( {
				explicitSitePath: targetSite.path,
				explicitName,
			} )
		);
	}

	return [ ...new Set( seeds ) ];
}

export async function getPullSessionMetadata(
	url: string,
	explicitName?: string,
	targetSite?: SiteData,
	explicitSitePath?: string
) {
	const normalizedUrl = normalizeSiteUrl( url );
	// Key the resume directory by the target location so re-runs resume the
	// same session and distinct targets (overwriting a site, creating at a
	// given path, or the default create) never collide for the same URL.
	const seeds = getPullSessionKeySeeds( { targetSite, explicitSitePath, explicitName } );
	const pullKey = getPrivateDirNameForImportSession( normalizedUrl, seeds[ 0 ] );
	const technicalSiteDirectory = path.join( PULLS_ROOT, pullKey );
	const existing = seeds
		.map( ( seed ) =>
			readPullMetadata(
				getMetadataPath(
					path.join( PULLS_ROOT, getPrivateDirNameForImportSession( normalizedUrl, seed ) )
				)
			)
		)
		.find( ( metadata ): metadata is PullSessionMetadata => !! metadata );

	if ( existing ) {
		return { created: false, studioMetadata: existing };
	}

	// Decide the local site name and location:
	//   - Overwrite mode: reuse the targeted site's identity and path verbatim
	//     (the caller clears it after confirmation, so skip the non-empty guard).
	//   - Explicit `--path`: create a new site at that path, named after --name
	//     or the folder.
	//   - Otherwise: create under ~/Studio, named after --name or the remote
	//     host, disambiguated against existing sites/dirs with a numeric suffix.
	// The name refers to the local site, not the remote source site.
	let siteName: string;
	let sitePath: string;
	if ( targetSite ) {
		siteName = targetSite.name;
		sitePath = targetSite.path;
	} else {
		if ( explicitSitePath ) {
			sitePath = explicitSitePath;
			siteName = explicitName || path.basename( explicitSitePath );
		} else if ( explicitName ) {
			siteName = explicitName;
			sitePath = getDefaultSitePath( siteName );
		} else {
			const cliConfig = await readCliConfig();
			const baseName = inferSiteNameFromUrl( normalizedUrl );
			siteName = await generateNumberedName(
				baseName,
				cliConfig.sites.map( ( site ) => site.name ),
				path.dirname( getDefaultSitePath( baseName ) )
			);
			sitePath = getDefaultSitePath( siteName );
		}
		if ( ( await fsUtils.pathExists( sitePath ) ) && ! ( await fsUtils.isEmptyDir( sitePath ) ) ) {
			throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
		}
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
		...( targetSite ? { siteId: targetSite.id, isOverwrite: true } : {} ),
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

async function findExistingSite( metadata: PullSessionMetadata ): Promise< SiteData | undefined > {
	const cliConfig = await readCliConfig();
	return cliConfig.sites.find(
		( site ) =>
			( metadata.siteId && site.id === metadata.siteId ) ||
			fsUtils.arePathsEqual( site.path, metadata.sitePath ) ||
			site.technicalSiteDirectory === metadata.technicalSiteDirectory
	);
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
		const existing = cliConfig.sites.find(
			( site ) =>
				( metadata.siteId && site.id === metadata.siteId ) ||
				fsUtils.arePathsEqual( site.path, metadata.sitePath ) ||
				site.technicalSiteDirectory === metadata.technicalSiteDirectory
		);

		if ( existing ) {
			// Reusing an existing site (a resumed pull or a `--path` overwrite):
			// repoint it at this pull's freshly generated runtime so the site
			// boots from the new content on the next `studio site start`.  Other
			// settings (port, PHP version, HTTPS) are preserved.
			existing.technicalSiteDirectory = metadata.technicalSiteDirectory;
			existing.runtimeBlueprintPath = metadata.runtimeBlueprintPath;
			await saveCliConfig( cliConfig );
			metadata.siteId = existing.id;
			metadata.port = existing.port;
			metadata.localUrl = getSiteUrl( existing );
			savePullMetadata( metadata );
			return { created: false, site: existing };
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

/**
 * Prepares an existing site to be overwritten by a `--path` pull: stops its
 * WordPress server if running (so we can safely replace its files and
 * database, mirroring `studio pull`) and clears its directory so reprint
 * flattens into a clean tree.  Safe to call again on resume — the raw download
 * lives in the technical directory, not the site directory.
 */
async function prepareTargetSiteForOverwrite( metadata: PullSessionMetadata ): Promise< void > {
	if ( metadata.siteId ) {
		try {
			await connectToDaemon();
			if ( await isServerRunning( metadata.siteId ) ) {
				logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
				await stopWordPressServer( metadata.siteId );
				await clearSiteLatestCliPid( metadata.siteId );
				logger.reportSuccess( __( 'WordPress server stopped' ) );
			}
		} finally {
			await disconnectFromDaemon();
		}
	}

	if ( await fsUtils.pathExists( metadata.sitePath ) ) {
		fs.rmSync( metadata.sitePath, { recursive: true, force: true } );
	}
}
