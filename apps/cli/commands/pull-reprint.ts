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
	type SiteStatus,
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
	stopWordPressServer,
	isServerRunning,
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
		describe: __(
			'Pull a remote WordPress site into an existing local site (run `studio create` first; remove with `studio delete`)'
		),
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
 * Where Studio stores the raw filesystem scratch space for each pulled
 * site — reprint's `.import-state.json`, the preflight cache, and the
 * raw/runtime working dirs.  Each site's pull lives in a subdirectory
 * keyed by its `siteId` (see {@link getPullTechnicalDirectory}); there is
 * no Studio-owned progress file. `studio delete` removes this scratch.
 */
const PULLS_ROOT = path.join( os.homedir(), '.studio', 'pulls' );

/**
 * The on-disk scratch layout for a site's pull, all derived from the
 * site's identity (`siteId`) and layout (`SiteData`).  There is no
 * Studio-owned progress file: "where do I continue from?" is computed
 * from observable state (reprint's own `.import-state.json` cursor,
 * whether the server is running, whether skipped files remain) and the
 * durable {@link SiteData} flags (`status`, `importComplete`), not from
 * a written stage cursor.
 */
interface PullSession {
	sitePath: string;
	localUrl: string;
	technicalSiteDirectory: string;
	rawDirectory: string;
	stateDirectory: string;
	runtimeDirectory: string;
	runtimeBlueprintPath: string;
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
 *   getPullSession (scratch layout from siteId) →
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
 * creates or deletes a site.  There is no Studio-owned progress file:
 * the site is marked `status: 'pulling'` up front and every phase is
 * idempotent, so a crash (or `Ctrl-C`) just leaves the site `pulling`
 * and re-running resumes by derivation — reprint resumes its own
 * pipeline from `.import-state.json`, the server-start phase keys off
 * whether the process is already running, and the skipped-files phase
 * keys off `hasSkippedFiles`.  A pull that errors or is killed lands the
 * site in `status: 'pull-failed'`; success returns it to `status:
 * 'ready'`.  Teardown is owned entirely by `studio delete`; this command
 * has no abort/rollback verb.
 *
 * Re-running after a full pull already completed (`SiteData.importComplete`)
 * performs a delta re-pull: reprint resets its own sub-command state via
 * prepare_repull().  Each phase is incremental — files re-sync as a delta
 * (re-index + diff), the database is fully re-downloaded and re-applied
 * (the dump is idempotent, so edits, inserts, and deletes all propagate).
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

	const sourceSite = await resolveSourceSite( site, remoteUrl, remoteSecret, verbose );
	if ( ! sourceSite ) {
		return;
	}

	const { url: sourceSiteUrl } = sourceSite;
	let secret = sourceSite.secret;
	const normalizedRemoteUrl = normalizeSiteUrl( sourceSiteUrl );
	const studioMetadata = getPullSession( site );
	const apiUrl = getReprintApiUrlForSite( normalizedRemoteUrl );

	// "Full pull vs. delta" is derived from the durable site flag, not a
	// stage cursor: a site that has already completed a full pull
	// (`importComplete`) re-runs as a delta sync. Reprint does the
	// incremental work against the preserved state directory — files
	// re-sync as a delta (re-index + diff), the database is fully
	// re-downloaded and re-applied (the dump is idempotent, so remote
	// edits, inserts, and deletes all land locally).
	const isRepull = Boolean( site.importComplete );

	// Resume vs. fresh is derived from observable on-disk state: a
	// non-empty reprint state directory means a prior run already started
	// pulling into this site. Computed before the mkdir below so the
	// freshly-created (empty) directory doesn't read as a resume.
	const hadScratch =
		fs.existsSync( studioMetadata.stateDirectory ) &&
		fs.readdirSync( studioMetadata.stateDirectory ).length > 0;

	if ( isRepull ) {
		// Re-verify connectivity (and give the secret-rotation retry path
		// a chance to run) instead of trusting the cached preflight from
		// the original pull, which may be days old.
		fs.rmSync( path.join( studioMetadata.stateDirectory, 'preflight.json' ), { force: true } );
	}

	// The target site pre-exists (created via `studio create`), so its
	// directory legitimately holds the blank WordPress install. The pull's
	// flatten stage overwrites it with the remote site's files; an
	// interrupted pull can therefore leave the site partially written.
	// Crash atomicity is a deferred follow-up (see the refactor overview);
	// the `pull-failed` status + idempotent re-run is the safety net.

	// Create the `~/.studio/pulls/<siteId>` directory structure for the
	// pull session scratch space.
	fs.mkdirSync( studioMetadata.rawDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.stateDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.runtimeDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.sitePath, { recursive: true } );

	if ( isRepull ) {
		console.log( `Updating "${ site.name }" from ${ normalizedRemoteUrl } (delta sync)` );
		console.log( '' );
	} else if ( hadScratch ) {
		console.log( `Resuming previous pull of "${ site.name }" from ${ normalizedRemoteUrl }` );
		console.log( '' );
	} else {
		console.log( `Pulling "${ site.name }" from ${ normalizedRemoteUrl }` );
	}
	console.log( `Technical directory: ${ studioMetadata.technicalSiteDirectory }` );
	console.log( `Site directory: ${ studioMetadata.sitePath }` );
	console.log( '' );

	// Capture the server's running state up front; a first pull restarts a
	// running site once it finishes (see the server-start step below).
	let wasRunning = false;
	try {
		wasRunning = Boolean( await isServerRunning( site.id ) );
	} finally {
		await disconnectFromDaemon();
	}

	// Mark the site as mid-pull up front, and record the scratch location
	// (`technicalSiteDirectory`) at the same time. The status means that
	// until this run finishes the site is not a healthy install, so other
	// commands (`site start`, `status`, `list`) surface it rather than treat
	// it as normal; persisting `technicalSiteDirectory` now (rather than only
	// at the later linking step) means `studio delete` can always trash the
	// scratch, even if the pull dies before linking. A crash here simply
	// leaves the site `pulling`; a re-run resumes.
	site.status = 'pulling';
	site.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
	await updateSiteRecord( site.id, ( record ) => {
		record.status = 'pulling';
		record.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
	} );

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
		// Persist the durable origin onto the site record: where it syncs
		// from, the remote's self-reported siteurl, the table prefix, and the
		// (possibly rotated) secret a resume will reuse.
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

		// A single `reprint pull` runs the whole pipeline in one PHP-WASM
		// fork: files-pull → db-pull → db-apply → flat-docroot →
		// apply-runtime. reprint owns the stage ordering internally and, on
		// a delta re-pull, resets its own sub-command state via
		// prepare_repull(). Always re-invoked: the pull is idempotent and
		// reprint resumes its own pipeline from `.import-state.json`, so
		// there is no Studio-side guard to skip it.
		normalizeReprintStateForEssentialFilesPull( studioMetadata.stateDirectory );
		await runFullPull(
			SITE_RUNTIME_NATIVE_PHP,
			studioMetadata,
			apiUrl,
			secret,
			verbose,
			! isRepull
		);

		// The site record already exists (created via `studio create`) and its
		// `technicalSiteDirectory` was recorded at pull start; the pull now
		// wires the generated runtime Blueprint onto it so `studio start` and
		// the daemon serve the imported runtime rather than the original blank
		// install. Idempotent — re-writing the same value on a resume is harmless.
		logger.reportStart( LoggerAction.CREATE_SITE, `Linking pulled files to "${ site.name }"…` );
		site.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
		await updateSiteRecord( site.id, ( record ) => {
			record.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
		} );
		logger.reportSuccess( `Site "${ site.name }" updated` );
		logger.reportKeyValuePair( 'id', site.id );

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

			const runningProcess = await isProcessRunning( getProcessName( site.id ) );

			if ( ! isRepull && wasRunning ) {
				// The live process is still serving the blank install whose
				// runtime the pull just replaced on disk, so restart it to load
				// the imported runtime.
				if ( runningProcess ) {
					await stopWordPressServer( site.id );
				}
				const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
				logger.reportSuccess( __( 'WordPress server restarted' ) );

				if ( processDesc.status === 'online' ) {
					await updateSiteLatestCliPid( site.id, processDesc.pid );
				}
			} else {
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
				} else {
					const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
					logger.reportSuccess( __( 'WordPress server started' ) );

					if ( processDesc.status === 'online' ) {
						await updateSiteLatestCliPid( site.id, processDesc.pid );
					}
				}
			}
		} catch ( serverError ) {
			throw new LoggerError(
				__( 'Failed to start the WordPress server for the pulled site.' ),
				serverError
			);
		} finally {
			await disconnectFromDaemon();
		}

		// Fetch the wp-content entries the essential-files pass skipped, if
		// any remain. Keyed off observable state (`hasSkippedFiles`), not a
		// stage cursor, so it runs exactly when there's a tail outstanding.
		if ( hasSkippedFiles( studioMetadata.stateDirectory ) ) {
			await downloadSkippedFiles( getSiteRuntime( site ), studioMetadata, apiUrl, secret, verbose );
		}

		// The pull (and server start) succeeded: the site is a healthy
		// install again. Record the durable first-full-pull marker (drives
		// the delta decision on the next run) and clear the `pulling`
		// status back to `ready`.
		await markImportComplete( site );
		await setSiteStatus( site, 'ready' );

		printCompletionMessage( site, studioMetadata.localUrl );
		process.exit( 0 );
	} catch ( error ) {
		// The pull errored or was killed mid-flight: the site directory may
		// be half-written, so mark it `pull-failed`. It is never trusted as
		// healthy again until an idempotent re-run restores it to `ready`
		// (or `site delete` removes it).
		await setSiteStatus( site, 'pull-failed' );

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
	sessionMetadata: PullSession,
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
 * Reprint refuses to resume a files sync with a different --filter than
 * the one stored in its state. A completed Studio pull may leave that
 * state on the post-pull skipped-earlier pass; mark that pass complete
 * and restore the filter expected by the next essential-files pull
 * without deleting the cursor/index files reprint needs for deltas.
 */
function normalizeReprintStateForEssentialFilesPull( stateDirectory: string ): void {
	const reprintState = readReprintState( stateDirectory );
	if ( reprintState?.filter && reprintState.filter !== 'essential-files' ) {
		const statePath = getReprintStatePath( stateDirectory );
		fs.writeFileSync(
			statePath,
			JSON.stringify(
				{
					...reprintState,
					status: 'complete',
					stage: null,
					filter: 'essential-files',
				},
				null,
				2
			) + '\n'
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
 * Idempotent: reprint resumes its own pipeline from `.import-state.json`
 * and resets for a delta re-pull internally, so the orchestrator always
 * re-invokes this with no Studio-side completion guard.
 *
 * `--force` is passed only on the first pull, where it overwrites the
 * blank WordPress install `studio create` produced. A delta re-pull
 * mutates the live site incrementally and must not force-overwrite it.
 */
export async function runFullPull(
	runtime: SiteRuntime,
	metadata: PullSession,
	apiUrl: string,
	secret: string,
	verbose: boolean,
	force: boolean
): Promise< void > {
	const contentDir = getContentDirFromState( metadata.stateDirectory );
	const sqlitePath = contentDir
		? `${ metadata.rawDirectory }${ contentDir }/database/.ht.sqlite`
		: `${ metadata.sitePath }/wp-content/database/.ht.sqlite`;
	const reprintRuntime = runtime === SITE_RUNTIME_NATIVE_PHP ? 'nginx-fpm' : 'playground-cli';
	const args = [
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
	];

	if ( force ) {
		args.push( '--force' );
	}

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Pulling site…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		args,
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
	metadata: PullSession,
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
 * Derives the on-disk scratch layout for refreshing an existing Studio
 * `site`. Pure: identity and layout come entirely from the
 * {@link SiteData} record (the scratch directory is keyed by `site.id`)
 * — nothing is read from or written to disk. Resume state is computed
 * later from observable state, not from a stored cursor.
 */
export function getPullSession( site: SiteData ): PullSession {
	const technicalSiteDirectory = getPullTechnicalDirectory( site.id );
	return {
		sitePath: site.path,
		localUrl: getSiteUrl( site ),
		technicalSiteDirectory,
		rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
		stateDirectory: path.join( technicalSiteDirectory, 'state' ),
		runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
		runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
	};
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
	metadata: Pick< PullSession, 'stateDirectory' | 'rawDirectory' >,
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
 * Mark the site as having completed a full pull at least once (durable
 * on the site record). Idempotent.
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
 * Persist the site's health {@link SiteStatus}. This is the durable
 * resume signal that replaces the old `pull.json` stage cursor:
 * `pulling` while a pull is in flight, `pull-failed` after it errors or
 * is killed, `ready` once it completes. No-op if the value is unchanged.
 */
async function setSiteStatus( site: SiteData, status: SiteStatus ): Promise< void > {
	if ( site.status === status ) {
		return;
	}
	site.status = status;
	await updateSiteRecord( site.id, ( record ) => {
		record.status = status;
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
