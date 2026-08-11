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
import { enableReprintExporter, rotateReprintSecret, type ReprintSurface } from 'cli/lib/api';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteByFolder, getSiteUrl, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, isProcessRunning } from 'cli/lib/daemon-client';
import {
	type ReprintProcessResult,
	runReprintCommandUntilComplete,
} from 'cli/lib/pull/migration-client';
import { preserveUnselectedLocalContent } from 'cli/lib/pull/preserve-local-content';
import { overallPercent, PullStep, withPercent } from 'cli/lib/pull/pull-progress';
import {
	fetchReprintPullTree,
	mapCliOnlyToReprint,
	resolveOnlyPathsToAbsolute,
	selectedSymlinksFor,
	selectPullItems,
	type SelectedSymlink,
} from 'cli/lib/pull/reprint-selector';
import {
	getAbspathFromState,
	getContentDirFromState,
	getCoreRootsFromState,
	hasLocalFilesIndex,
	getTablePrefixFromState,
	hasSkippedFiles,
	markSkippedFilesPending,
	resetEssentialFilesState,
	setSqliteRuntimeTarget,
} from 'cli/lib/pull/reprint-state';
import {
	ensureImportedSiteSqliteReady,
	loadImportedRuntimeStartOptions,
	loadImportedRuntimeStartOptionsNative,
} from 'cli/lib/pull/runtime-start-options';
import { buildAutoLoginUrl } from 'cli/lib/site-utils';
import { ensureSqliteIntegrationForImportedSite } from 'cli/lib/sqlite-integration';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import {
	findSyncSiteByIdentifier,
	getSyncSupportError,
	pickSyncSite,
} from 'cli/lib/sync-site-picker';
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
				.option( 'remote-site', {
					type: 'string',
					description: __( 'Remote site URL or ID' ),
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
			const verbose = argv.verbose;

			try {
				await runCommand( argv.path, argv.remoteSite, verbose, {
					only: argv.only as string[] | undefined,
					skipDatabase: argv[ 'skip-database' ] as boolean,
					skipUploads: argv[ 'skip-uploads' ] as boolean,
				} );
			} catch ( error ) {
				if ( error instanceof PullError ) {
					logger.reportError( error );
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
 * The user's selective-sync choice for the pull in flight (interactive
 * selector or `--only`/`--skip-*` flags). An empty object means "pull
 * everything".
 */
interface PullSelection {
	skipDatabase?: boolean;
	skipUploads?: boolean;
	fileOnlyPaths?: string[];
	/**
	 * Selected entries that are symlinks on the remote. A scoped listing
	 * follows the link (its files arrive under the target path) but never
	 * lists the `--only` root itself, so the link is recreated after the
	 * file pull.
	 */
	symlinkPaths?: SelectedSymlink[];
}

/** Raw selective-sync CLI flags (`--only`, `--skip-database`, `--skip-uploads`). */
interface CliSelectionOptions {
	only?: string[];
	skipDatabase?: boolean;
	skipUploads?: boolean;
}

/**
 * The selection is the one piece of per-pull state that cannot be derived
 * from observable state: it is user input, and a resumed pull must reuse
 * the exact same choice (reprint refuses to resume a files-pull whose
 * `--only` set changed mid-flight). It lives in a small sidecar file in
 * the scratch directory — written when chosen, deleted when the pull
 * completes so the next pull asks again. It is NOT a progress cursor.
 */
const SELECTION_FILE = 'selection.json';

function getSelectionPath( session: PullSession ): string {
	return path.join( session.stateDirectory, SELECTION_FILE );
}

function readPullSelection( session: PullSession ): PullSelection | null {
	try {
		return JSON.parse( fs.readFileSync( getSelectionPath( session ), 'utf-8' ) );
	} catch {
		return null; // missing or unreadable → no prior selection
	}
}

function savePullSelection( session: PullSession, selection: PullSelection ): void {
	fs.mkdirSync( session.stateDirectory, { recursive: true } );
	fs.writeFileSync( getSelectionPath( session ), JSON.stringify( selection, null, 2 ) + '\n' );
}

function clearPullSelection( session: PullSession ): void {
	fs.rmSync( getSelectionPath( session ), { force: true } );
}

/**
 * Normalized result of turning CLI arguments into something the pull
 * pipeline can act on: a WordPress.com/Pressable site URL to fetch from,
 * the HMAC secret the exporter will check, and the API identity needed to
 * enable the exporter.
 */
interface PullSource {
	secret: string;
	surface: ReprintSurface;
	url: string;
	wpComSite: SyncSite;
	wpComToken: StoredAuthToken;
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
 *   runPreflight →
 *   saveReprintOrigin (durable origin onto SiteData) →
 *   runFullPull (pull-files → pull-db (unless the database is
 *     excluded) → flat-docroot → apply-runtime) →
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
	remoteSite?: string,
	verbose = false,
	cliSelection: CliSelectionOptions = {}
): Promise< void > {
	logger.reportStart(
		LoggerAction.LOAD_SITES,
		withPercent( __( 'Loading site…' ), overallPercent( PullStep.SETUP ) )
	);
	const site = await getSiteByFolder( localPath );
	logger.reportSuccess( __( 'Site loaded' ) );

	const sourceSite = await resolveSourceSite(
		remoteSite ?? site.reprintOrigin?.remoteUrl,
		verbose
	);
	if ( ! sourceSite ) {
		return;
	}

	const { url: sourceSiteUrl } = sourceSite;
	const secret = sourceSite.secret;
	const normalizedRemoteUrl = normalizeSiteUrl( sourceSiteUrl );
	const studioMetadata = getPullSession( site );
	// `resolveSourceSite` already probed the exporter and enabled it; the
	// detected surface decides the importer query var (v1 `?reprint-api` vs v2
	// `?reprint-api-jetpack`) just as it decided the rotate route for the secret.
	const apiUrl = getReprintApiUrlForSite( normalizedRemoteUrl, sourceSite.surface );

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
		// Re-verify connectivity instead of trusting the cached preflight
		// from the original pull, which may be days old.
		fs.rmSync( path.join( studioMetadata.stateDirectory, 'preflight.json' ), { force: true } );
	}

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

	let wasRunning = false;
	try {
		wasRunning = Boolean( await isServerRunning( site.id ) );
	} finally {
		await disconnectFromDaemon();
	}

	site.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
	await updateSiteRecord( site.id, ( record ) => {
		record.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
	} );

	try {
		const preflight = await runPreflight(
			SITE_RUNTIME_NATIVE_PHP,
			studioMetadata,
			apiUrl,
			secret,
			verbose
		);
		// Selective sync: apply `--only`/`--skip-*` flags, or prompt
		// interactively with the wp-content folder tree + database toggle.
		// A partial first-pull selection gets the core roots added and the
		// unselected local content preserved. A resumed pull reuses the
		// persisted choice without re-prompting. Runs before the site is
		// marked `pulling` so a cancel is a clean no-op.
		const selection = await applySelection( {
			session: studioMetadata,
			isFirstPull: ! site.importComplete || ! hasLocalFilesIndex( studioMetadata.stateDirectory ),
			cli: cliSelection,
			apiUrl,
			secret,
			verbose,
		} );
		if ( ! selection ) {
			console.log( __( 'Cancelled.' ) );
			return;
		}

		// Persist the durable origin onto the site record: where it syncs
		// from, the remote's self-reported siteurl, and the table prefix.
		// The Reprint secret is intentionally rotated for each run, not
		// stored for later reuse.
		const origin = {
			remoteUrl: normalizedRemoteUrl,
			remoteSiteUrl: preflight.siteurl || normalizedRemoteUrl,
			tablePrefix: preflight.table_prefix || undefined,
		};
		site.reprintOrigin = origin;
		await updateSiteRecord( site.id, ( record ) => {
			record.reprintOrigin = origin;
		} );

		// `pulling` means "the site directory is half-written", so it is set
		// only once the pull reaches the steps that rewrite it — not here.
		// The downloads run entirely in the scratch, so a dropped connection
		// (by far the likeliest failure) leaves the site intact and startable
		// rather than stranding it in `pull-failed`.
		const markSiteBeingWritten = async () => {
			site.status = 'pulling';
			await updateSiteRecord( site.id, ( record ) => {
				record.status = 'pulling';
			} );
		};

		// db-apply (run inside `pull-db`) rewrites the remote site URL to
		// the local one the Studio server already serves —
		// `studioMetadata.localUrl` comes from the existing site's port, so
		// no port allocation is needed here.

		// The pull pipeline runs as separate reprint commands (pull-files →
		// pull-db → flat-docroot → apply-runtime) so the selection can skip
		// the database step entirely; see runFullPull. Always re-invoked:
		// every command is idempotent and reprint resumes its own pipeline
		// from `.import-state.json`, so there is no Studio-side guard.
		await runFullPull(
			SITE_RUNTIME_NATIVE_PHP,
			studioMetadata,
			apiUrl,
			secret,
			verbose,
			! isRepull,
			selection,
			markSiteBeingWritten
		);

		// The site record already exists (created via `studio create`) and its
		// `technicalSiteDirectory` was recorded at pull start; the pull now
		// wires the generated runtime Blueprint onto it so `studio start` and
		// the daemon serve the imported runtime rather than the original blank
		// install. Idempotent — re-writing the same value on a resume is harmless.
		logger.reportStart(
			LoggerAction.CREATE_SITE,
			withPercent( `Linking pulled files to "${ site.name }"…`, overallPercent( PullStep.LINK ) )
		);
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

		// `flat-docroot --force` replaced wp-content — SQLite drop-in included —
		// with a symlink into the scratch. runtime.php wires SQLite up separately
		// so the site boots, but phpMyAdmin and `wp sqlite` read the integration
		// from wp-content. `studio site start` would reinstall it, except it
		// returns early while the server runs — which it does right after a pull.
		await ensureSqliteIntegrationForImportedSite( site );

		let runtimeStartOptions: StartServerOptions;
		if ( getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP ) {
			const nativeStartOptions = loadImportedRuntimeStartOptionsNative( studioMetadata );
			if ( ! nativeStartOptions ) {
				throw new LoggerError(
					`Missing runtime.php in ${ studioMetadata.runtimeDirectory }. Re-run \`studio pull-reprint\` to regenerate the runtime configuration.`
				);
			}
			runtimeStartOptions = nativeStartOptions;
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

		logger.reportStart(
			LoggerAction.START_SITE,
			withPercent( __( 'Starting WordPress server…' ), overallPercent( PullStep.START ) )
		);

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
				await startWordPressServer( site, logger, runtimeStartOptions );
				logger.reportSuccess( __( 'WordPress server restarted' ) );
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
					await startWordPressServer( site, logger, runtimeStartOptions );
					logger.reportSuccess( __( 'WordPress server started' ) );
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

		if ( studioMetadata.localUrl ) {
			console.log( '' );
			console.log( `Site "${ site.name }" is ready.` );
			console.log( '' );
			printSiteUrls( studioMetadata.localUrl );
		}

		// Fetch the wp-content entries the essential-files pass skipped, if
		// any remain — unless the user excluded the media library. Keyed off
		// observable state (`hasSkippedFiles`), not a stage cursor, so it
		// runs exactly when there's a tail outstanding.
		if ( ! selection.skipUploads && hasSkippedFiles( studioMetadata.stateDirectory ) ) {
			await downloadSkippedFiles(
				getSiteRuntime( site ),
				studioMetadata,
				apiUrl,
				secret,
				verbose,
				selection
			);
		}

		// The pull is done: drop the selection sidecar so the next pull asks
		// again instead of silently reusing this run's choice.
		clearPullSelection( studioMetadata );

		// The percentage has to ride an in-progress message — `pullSite` only
		// parses the token out of those, so the success below can't close the bar.
		logger.reportProgress( withPercent( __( 'Pull complete' ), 100 ) );
		logger.reportSuccess( __( 'Pull complete' ) );

		site.importComplete = true;
		site.status = 'ready';
		await updateSiteRecord( site.id, ( record ) => {
			record.importComplete = true;
			record.status = 'ready';
		} );

		console.log( '' );
		console.log( `Site "${ site.name }" pulled successfully.` );
		console.log( '' );
		if ( studioMetadata.localUrl ) {
			printSiteUrls( studioMetadata.localUrl );
		}

		process.exit( 0 );
	} catch ( error ) {
		// Mark the site `pull-failed` if the error was thrown after it was
		// marked `pulling`.
		if ( site.status === 'pulling' ) {
			site.status = 'pull-failed';
			await updateSiteRecord( site.id, ( record ) => {
				record.status = 'pull-failed';
			} );
		}

		const resumeCommand = [ 'studio pull-reprint', `--path "${ localPath }"` ];
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
 * Resolve the selective-sync choice for this pull. Returns the selection
 * (empty object = pull everything) or `null` when the user cancelled the
 * interactive prompt.
 *
 * Order of precedence:
 *   1. Resuming an unfinished pull → reuse the persisted selection (reprint
 *      refuses to resume a files-pull whose `--only` set changed).
 *   2. `--only`/`--skip-*` flags → apply non-interactively.
 *   3. Non-interactive with no flags → pull everything.
 *   4. Interactive → the wp-content folder tree + database toggle.
 *
 * reprint's `--only` is an include-list that *replaces* the default
 * export roots, and on a **first pull** the raw fs-root has no WordPress
 * core yet — so any partial first-pull selection gets the
 * preflight-detected core roots prepended. The unselected wp-content
 * folders (and a skipped database) keep their local contents: they are
 * carried into the scratch before flattening (see
 * preserve-local-content.ts).
 */
async function applySelection( params: {
	session: PullSession;
	isFirstPull: boolean;
	cli: CliSelectionOptions;
	apiUrl: string;
	secret: string;
	verbose: boolean;
} ): Promise< PullSelection | null > {
	const { session, isFirstPull, cli, apiUrl, secret, verbose } = params;

	// A partial first-pull `--only` set must include the core roots. When
	// preflight did not expose them, fall back to a full file pull rather
	// than assemble a coreless, unbootable site. `databaseOnly` marks the
	// "no folders selected" case, which still needs core on a first pull.
	const withCoreRootsOnFirstPull = ( fileOnlyPaths: string[], databaseOnly = false ): string[] => {
		if ( ! isFirstPull || ( fileOnlyPaths.length === 0 && ! databaseOnly ) ) {
			return fileOnlyPaths;
		}
		const coreRoots = getCoreRootsFromState( session.stateDirectory );
		if ( coreRoots.length === 0 ) {
			console.log(
				__(
					'Could not determine where WordPress core lives on the remote site; pulling all files instead of the selection.'
				)
			);
			return [];
		}
		return [
			...coreRoots,
			...fileOnlyPaths.filter( ( onlyPath ) => ! coreRoots.includes( onlyPath ) ),
		];
	};

	// Reuse the selection captured by a prior interrupted run. The sidecar is
	// written when a selection is chosen and removed once the pull succeeds,
	// so its presence already means "a prior run started and did not finish"
	// — reprint refuses to resume a files-pull whose `--only` set changed, so
	// the choice is reused rather than re-derived. It is announced because it
	// silently overrides this run's flags (and a UI pull's full-pull intent).
	//
	// A folder selection can outlive the scratch that made it a delta (damage
	// wipe): re-anchor it with the core roots so the fresh initial sync still
	// downloads WordPress core.
	const persisted = readPullSelection( session );
	if ( persisted ) {
		const healed = withCoreRootsOnFirstPull( persisted.fileOnlyPaths ?? [] );
		if ( healed.length !== ( persisted.fileOnlyPaths?.length ?? 0 ) ) {
			persisted.fileOnlyPaths = healed.length > 0 ? healed : undefined;
			savePullSelection( session, persisted );
		}
		console.log(
			__( 'Resuming the interrupted pull, so its original content selection is reused.' )
		);
		return persisted;
	}

	// Keeping the local database is only possible when one exists — a
	// `studio create` site that was never started has no SQLite file yet
	// (it is created on first boot), and the pull would end on WordPress's
	// database-connection error page.
	const assertLocalDatabaseAvailable = ( selection: PullSelection ): void => {
		if ( ! selection.skipDatabase ) {
			return;
		}
		const contentDir = getContentDirFromState( session.stateDirectory ) ?? '';
		const candidates = [
			path.join( session.sitePath, 'wp-content', 'database', '.ht.sqlite' ),
			path.join(
				session.rawDirectory,
				...contentDir.split( '/' ).filter( Boolean ),
				'database',
				'.ht.sqlite'
			),
		];
		if ( ! candidates.some( ( candidate ) => fs.existsSync( candidate ) ) ) {
			throw new LoggerError(
				__(
					'The local site has no database yet (it is created the first time the site starts), so the database cannot be excluded from this pull. Include the database, or start the site once and pull again.'
				)
			);
		}
	};

	const cliOnly = cli.only?.filter( ( value ) => value.trim().length > 0 ) ?? [];
	const cliDriven = cliOnly.length > 0 || cli.skipDatabase || cli.skipUploads;

	if ( cliDriven ) {
		const selection: PullSelection = {
			skipDatabase: !! cli.skipDatabase,
			skipUploads: !! cli.skipUploads,
		};
		if ( cliOnly.length > 0 ) {
			const contentDir = getContentDirFromState( session.stateDirectory );
			if ( ! contentDir ) {
				throw new LoggerError(
					__(
						'Could not determine the remote wp-content path from preflight state, so --only cannot be used for this site. Run a full pull, or try again.'
					)
				);
			}
			const mapped = mapCliOnlyToReprint( cliOnly, contentDir );
			// Selected entries that are symlinks on the remote need their
			// links recreated after the scoped pull; the remote index is the
			// only place that knows which ones those are.
			const { linkTargets } = await fetchReprintPullTree( {
				stateDirectory: session.stateDirectory,
				rawDirectory: session.rawDirectory,
				apiUrl,
				secret,
				runtime: SITE_RUNTIME_NATIVE_PHP,
				verbose,
			} );
			const contentRoot = contentDir.replace( /\/+$/, '' );
			const symlinkPaths = selectedSymlinksFor(
				resolveOnlyPathsToAbsolute( mapped, contentDir )
					.filter( ( absolute ) => absolute.startsWith( `${ contentRoot }/` ) )
					.map( ( absolute ) => absolute.slice( contentRoot.length + 1 ) ),
				contentDir,
				linkTargets
			);
			if ( symlinkPaths.length > 0 ) {
				selection.symlinkPaths = symlinkPaths;
			}
			const withCore = withCoreRootsOnFirstPull( mapped );
			if ( withCore.length > 0 ) {
				selection.fileOnlyPaths = withCore;
			}
		}
		assertLocalDatabaseAvailable( selection );
		savePullSelection( session, selection );
		return selection;
	}

	if ( ! process.stdin.isTTY ) {
		// Non-interactive with no flags → pull everything. Persisted anyway so
		// a later interactive resume cannot change `--only` mid-flight.
		const selection: PullSelection = {};
		savePullSelection( session, selection );
		return selection;
	}

	// The wp-content folder tree + database toggle. On a first pull a
	// database-only choice is meaningful (core + local files + remote
	// database); on a delta it is rejected inside selectPullItems.
	const { tree, contentDir, linkTargets } = await fetchReprintPullTree( {
		stateDirectory: session.stateDirectory,
		rawDirectory: session.rawDirectory,
		apiUrl,
		secret,
		runtime: SITE_RUNTIME_NATIVE_PHP,
		verbose,
	} );
	if ( tree.length === 0 || ! contentDir ) {
		const selection: PullSelection = {};
		savePullSelection( session, selection );
		return selection;
	}
	const picked = await selectPullItems( tree, contentDir, {
		allowDatabaseOnly: isFirstPull,
		linkTargets,
	} );
	if ( ! picked ) {
		return null;
	}
	const fileOnlyPaths = withCoreRootsOnFirstPull( picked.fileOnlyPaths, ! picked.hasAnyFile );
	const selection: PullSelection = {
		skipDatabase: picked.skipDatabase,
		skipUploads: picked.skipUploads,
	};
	if ( fileOnlyPaths.length > 0 ) {
		selection.fileOnlyPaths = fileOnlyPaths;
	}
	if ( picked.symlinkPaths.length > 0 ) {
		selection.symlinkPaths = picked.symlinkPaths;
	}
	assertLocalDatabaseAvailable( selection );
	savePullSelection( session, selection );
	return selection;
}

/**
 * Runs `reprint preflight` against the remote site and caches the
 * response envelope at `stateDirectory/preflight.json`.
 *
 * The first direct request to the site happens here. Failures surface as
 * recognizable PullErrors with technical details for verbose output.
 * Returns the handful of site-identity fields runCommand needs to record
 * on the metadata before the download stages begin.
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

	logger.reportStart(
		LoggerAction.PREFLIGHT,
		withPercent( __( 'Initiating the migration…' ), overallPercent( PullStep.PREFLIGHT ) )
	);

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
 * The `~/.studio/pulls/<siteId>` scratch root for a site's pull. Keyed
 * by `siteId` (not a URL hash) so it follows the site, not the remote.
 */
function getPullTechnicalDirectory( siteId: string ): string {
	return path.join( PULLS_ROOT, siteId );
}

/**
 * Make sure the wp-config.php that wp-load.php will read exists and is
 * non-empty after a `--only`-scoped pull.
 *
 * WordPress resolves symlinks, so a pulled site boots through the raw
 * scratch: wp-load looks for wp-config.php in the raw ABSPATH, then in
 * its parent. On WP Cloud the parent copy is a symlink to
 * `<document_root>/wp-config.php`, which sits outside every `--only`
 * prefix of a scoped pull — the link is recreated but its target is
 * never fetched. When both candidates are missing or empty, write a
 * minimal config: wp-load defines ABSPATH before loading it and the
 * generated runtime prepend defines the database constants, so only the
 * table prefix and the wp-settings handoff are needed.
 */
export function ensureScopedPullWpConfig( metadata: PullSession ): void {
	const abspath = getAbspathFromState( metadata.stateDirectory );
	if ( ! abspath ) {
		return;
	}

	const segments = abspath.split( '/' ).filter( Boolean );
	const rawAbspath = path.join( metadata.rawDirectory, ...segments );
	const candidates = [ path.join( rawAbspath, 'wp-config.php' ) ];
	if ( segments.length > 0 ) {
		candidates.push( path.join( path.dirname( rawAbspath ), 'wp-config.php' ) );
	}

	for ( const candidate of candidates ) {
		try {
			// statSync follows symlinks: a dangling link falls through to
			// the catch, an empty target reports size 0.
			if ( fs.statSync( candidate ).size > 0 ) {
				return;
			}
		} catch {
			// Missing — keep looking.
		}
	}

	const tablePrefix = getTablePrefixFromState( metadata.stateDirectory ) ?? 'wp_';
	// Escape for a PHP single-quoted string: backslashes first, then single
	// quotes (both are the only special characters there).
	const escapedTablePrefix = tablePrefix.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
	// Written to the last candidate wp-load checks; writeFileSync follows
	// an existing symlink and creates its target.
	const target = candidates[ candidates.length - 1 ];
	fs.mkdirSync( path.dirname( target ), { recursive: true } );
	fs.writeFileSync(
		target,
		[
			'<?php',
			'/**',
			' * Generated by Studio: the remote wp-config.php was outside the',
			" * scoped pull's selection. Database constants come from the",
			' * runtime prepend; ABSPATH is defined by wp-load.php.',
			' */',
			`$table_prefix = '${ escapedTablePrefix }';`,
			'',
			"require_once ABSPATH . 'wp-settings.php';",
			'',
		].join( '\n' )
	);
}

/**
 * Recreate the selected symlinks in the raw scratch after a scoped file
 * pull, mirroring how reprint recreates links it finds in listings:
 * relative, so the whole scratch stays relocatable. Idempotent — an
 * existing entry is left alone.
 */
export function restoreSelectedSymlinks(
	metadata: PullSession,
	symlinkPaths: SelectedSymlink[]
): void {
	for ( const { path: linkPath, target } of symlinkPaths ) {
		const rawLink = path.join( metadata.rawDirectory, ...linkPath.split( '/' ).filter( Boolean ) );
		try {
			fs.lstatSync( rawLink );
			continue;
		} catch {
			// Missing — recreate it.
		}
		const rawTarget = path.join( metadata.rawDirectory, ...target.split( '/' ).filter( Boolean ) );
		fs.mkdirSync( path.dirname( rawLink ), { recursive: true } );
		fs.symlinkSync( path.relative( path.dirname( rawLink ), rawTarget ), rawLink );
	}
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
 *      directory. `--force` is passed only on the first pull, where it
 *      overwrites the blank WordPress install `studio create` produced;
 *      a delta re-pull refreshes existing symlinks and must not
 *      force-overwrite the live site.
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
 * {@link runReprintCommandUntilComplete}) and idempotent, so the
 * orchestrator always re-invokes the sequence with no Studio-side
 * completion guard.
 */
export async function runFullPull(
	runtime: SiteRuntime,
	metadata: PullSession,
	apiUrl: string,
	secret: string,
	verbose: boolean,
	force: boolean,
	selection: PullSelection = {},
	/**
	 * Invoked once, immediately before the first step that writes the site
	 * directory. Everything up to here lands in the scratch, so a failure
	 * leaves the local site untouched — this is where it stops being true.
	 */
	onBeforeSiteWrite?: () => Promise< void >
): Promise< void > {
	const contentDir = getContentDirFromState( metadata.stateDirectory );
	const sqlitePath = contentDir
		? path.join(
				metadata.rawDirectory,
				...contentDir.split( '/' ).filter( Boolean ),
				'database',
				'.ht.sqlite'
		  )
		: path.join( metadata.sitePath, 'wp-content', 'database', '.ht.sqlite' );
	const reprintRuntime = runtime === SITE_RUNTIME_NATIVE_PHP ? 'nginx-fpm' : 'playground-cli';
	const onlyArgs = ( selection.fileOnlyPaths ?? [] ).map( ( onlyPath ) => `--only=${ onlyPath }` );

	const runStep = ( step: PullStep, progressLabel: string, args: string[] ) =>
		runReprintCommandUntilComplete(
			metadata.stateDirectory,
			metadata.rawDirectory,
			args,
			( progress, fraction ) =>
				logger.reportProgress( withPercent( progress, overallPercent( step, fraction ) ) ),
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

	// A non-empty raw fs-root without a local files index is a damaged or
	// partially-written scratch: reprint refuses an initial sync into it
	// ("Target directory is not empty and no cursor found"), and its
	// preserve-local escape hatch silently skips every file behind a stale
	// blocker entry. The raw directory is Studio-owned scratch, so clear it
	// and start a clean initial sync instead (preflight state and the
	// persisted selection survive the reset — applySelection re-anchors a
	// folder selection with the core roots for the fresh initial sync).
	const rawEntries = fs.existsSync( metadata.rawDirectory )
		? fs.readdirSync( metadata.rawDirectory )
		: [];
	if ( rawEntries.length > 0 && ! hasLocalFilesIndex( metadata.stateDirectory ) ) {
		fs.rmSync( metadata.rawDirectory, { recursive: true, force: true } );
		fs.mkdirSync( metadata.rawDirectory, { recursive: true } );
		resetEssentialFilesState( metadata.stateDirectory );
	}

	logger.reportStart(
		LoggerAction.DOWNLOAD_FILES,
		withPercent( __( 'Pulling site…' ), overallPercent( PullStep.FILES ) )
	);

	// 1. Files. `--only` restricts the download to the selected wp-content
	// folders; essential-files defers the media library to the post-start
	// skipped-earlier pass.
	await runStep( PullStep.FILES, __( 'Pulling files' ), [
		'pull-files',
		apiUrl,
		`--secret=${ secret }`,
		'--filter=essential-files',
		...onlyArgs,
		'--no-adaptive',
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	] );

	// 2. Database — only when selected. Skipping it keeps the local
	// database, but apply-runtime generates the SQLite runtime section
	// only from the target that db-apply persists — record it explicitly,
	// pointing at the kept database.
	if ( ! selection.skipDatabase ) {
		await runStep( PullStep.DATABASE, __( 'Pulling database' ), [
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
	} else {
		setSqliteRuntimeTarget( metadata.stateDirectory, sqlitePath );
	}

	// Everything above landed in the scratch; from here on the site
	// directory itself is rewritten — step 3 *moves* local wp-content
	// entries out of it, and the flatten then replaces the directory.
	await onBeforeSiteWrite?.();

	// 3. Carry the unselected local wp-content entries (and a kept
	// database) into the scratch before flattening replaces the site's
	// wp-content with a symlink into it. No-op once the site is flattened.
	if ( contentDir ) {
		preserveUnselectedLocalContent( {
			sitePath: metadata.sitePath,
			rawDirectory: metadata.rawDirectory,
			contentDir,
			selectedPrefixes: resolveOnlyPathsToAbsolute( selection.fileOnlyPaths ?? [], contentDir ),
			skipDatabase: selection.skipDatabase,
			skipUploads: selection.skipUploads,
		} );
	}

	// A scoped pull can miss the real wp-config.php: on WP Cloud it lives
	// at the document root — outside both the core roots and any
	// wp-content selection — reachable only through a symlink under the
	// core root. Synthesize a minimal one so WordPress can boot.
	if ( ( selection.fileOnlyPaths ?? [] ).length > 0 ) {
		ensureScopedPullWpConfig( metadata );
	}

	// Recreate the selected entries that are symlinks on the remote (wp.com
	// serves each plugin as a symlink into a shared store): the scoped pull
	// downloaded their targets but never the links themselves.
	restoreSelectedSymlinks( metadata, selection.symlinkPaths ?? [] );

	// 4. Flatten the raw download into the site directory. `-` is the URL
	// placeholder for local commands.
	await runStep( PullStep.FLATTEN, __( 'Flattening layout' ), [
		'flat-docroot',
		'-',
		`--flatten-to=${ metadata.sitePath }`,
		...( force ? [ '--force' ] : [] ),
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	] );

	// 5. Runtime config — last, so it reads the DB credentials pull-db wrote
	// to state. apply-runtime takes no URL positional, and
	// --flat-document-root replaces --fs-root (they are mutually exclusive).
	await runStep( PullStep.RUNTIME, __( 'Preparing runtime' ), [
		'apply-runtime',
		`--runtime=${ reprintRuntime }`,
		`--output-dir=${ metadata.runtimeDirectory }`,
		`--flat-document-root=${ metadata.sitePath }`,
		`--state-dir=${ metadata.stateDirectory }`,
	] );

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
	verbose: boolean,
	selection: PullSelection = {}
): Promise< void > {
	logger.reportStart(
		LoggerAction.DOWNLOAD_FILES,
		withPercent( __( 'Downloading remaining files…' ), overallPercent( PullStep.REMAINING ) )
	);

	// Studio's split pipeline runs pull-db between pull-files and this
	// tail, and pull-db's prepare_repull() resets the skipped_pending flag
	// the tail's recovery keys on; restore it (see markSkippedFilesPending).
	markSkippedFilesPending( metadata.stateDirectory );

	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		[
			'files-sync',
			apiUrl,
			`--secret=${ secret }`,
			// Required both to start the tail from a completed essential-files
			// pull and to match the persisted filter when resuming into an
			// in-progress fetch-skipped run.
			'--filter=skipped-earlier',
			// Carry the same `--only` set as pull-files: files-pull refuses to
			// resume against the shared state dir with a different `--only`
			// (its index is a union keyed by a fingerprint of the prefixes).
			...( selection.fileOnlyPaths ?? [] ).map( ( onlyPath ) => `--only=${ onlyPath }` ),
			// Per-batch ceiling — one sub-process yields after 30 s and the
			// client reconnects to continue.  Not a total-time budget; a slow
			// or high-latency sync just makes more round-trips.  Kept well
			// under common proxy/LB idle timeouts (~60 s).
			'--max-exec=30',
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
		],
		( progress, fraction ) =>
			logger.reportProgress(
				withPercent( progress, overallPercent( PullStep.REMAINING, fraction ) )
			),
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
	normalized.searchParams.delete( 'reprint-api-jetpack' );
	return normalized.toString();
}

/**
 * Resolves the **remote source** to pull from. A valid source must be
 * present in the user's WordPress.com Jetpack API site list, which also
 * includes Pressable sites on the same platform. Handles two input
 * patterns:
 *
 *   1. Identifier provided — a site URL or WordPress.com site ID, resolved
 *      against the connected WordPress.com/Pressable sites through the same
 *      helper `pull` and `push` use, then the exporter is enabled and a fresh
 *      secret is rotated.
 *   2. No identifier — among pullable (`syncable`) sites only: if the user has
 *      exactly one, pick it; with several, show an interactive picker in a
 *      TTY (returning `null` if the user cancels) or error out when run
 *      non-interactively. Non-pullable sites (Simple, or missing hosting
 *      features) are surfaced as disabled in the picker.
 */
export async function resolveSourceSite(
	identifier?: string,
	verbose = false
): Promise< PullSource | null > {
	const token = await readAuthToken();
	if ( ! token ) {
		throw new LoggerError(
			__(
				'WordPress.com authentication is required. Run `studio auth login` to pull a WordPress.com or Pressable site.'
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

	if ( identifier ) {
		// Throws when nothing matches, when several sites share the hostname,
		// or when the match isn't syncable.
		wpComSite = findSyncSiteByIdentifier( sites, identifier );
		resolvedUrl = wpComSite.url;
	} else {
		// Only sites that can run the reprint exporter — those with hosting
		// features enabled (`syncable`) — are pull candidates.
		const pullableSites = sites.filter( ( site ) => site.syncSupport === 'syncable' );
		if ( pullableSites.length === 0 ) {
			// When the account has exactly one site and it can't be pulled
			// (e.g. a lone Business-plan site awaiting Atomic transfer), report
			// the specific condition and next step rather than a generic
			// "nothing to pull" message.
			if ( sites.length === 1 ) {
				throw getSyncSupportError( sites[ 0 ] );
			}
			throw new LoggerError(
				__(
					'No pullable WordPress.com or Pressable sites found. Pulling requires a site with hosting features enabled.'
				)
			);
		}

		if ( pullableSites.length > 1 ) {
			// In a real terminal, let the user pick interactively. Outside a
			// TTY (CI, or Studio driving the command) there's no way to
			// prompt, so exit with guidance to pass `--remote-site` — the realistic
			// non-TTY caller already does.
			if ( ! process.stdin.isTTY ) {
				throw new LoggerError(
					__(
						'Multiple WordPress.com sites are available. Re-run with `--remote-site <site-url-or-id>`.'
					)
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

	// Provision the exporter and learn the site's export surface, then rotate a
	// fresh secret for that surface. Deciding the surface here (once) is what
	// keeps the rotate route and the importer query var in agreement.
	const surface = await enableReprintExporter( wpComSite.id, token.accessToken, verbose );
	return {
		url: resolvedUrl,
		surface,
		secret: await rotateReprintSecret( wpComSite.id, token.accessToken, surface ),
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
 * Returns the export endpoint URL on a remote site for the given normalized
 * site URL.  The reprint exporter mounts its API on a query-arg marker instead
 * of a REST route so it intercepts requests before WordPress's full bootstrap
 * runs.  The marker depends on the export surface: v2 (the Jetpack surface)
 * uses `?reprint-api-jetpack`, v1 `?reprint-api`.
 */
export function getReprintApiUrlForSite( siteUrl: string, surface: ReprintSurface = 'v1' ): string {
	const apiUrl = new URL( siteUrl );
	apiUrl.search = surface === 'v2' ? '?reprint-api-jetpack' : '?reprint-api';
	return apiUrl.toString();
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
