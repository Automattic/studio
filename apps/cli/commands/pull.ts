/**
 * `studio pull`: pulls a WordPress.com or Pressable site into an
 * existing local Studio site with Reprint.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
	addConnectedWpcomSite,
	getConnectedWpcomSitesForLocalSite,
	markConnectedWpcomSiteSynced,
} from '@studio/common/lib/connected-sites';
import { encodePassword } from '@studio/common/lib/passwords';
import { buildSyncEventProps } from '@studio/common/lib/sync/build-sync-event-props';
import { PullCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import chalk from 'chalk';
import { enableReprintExporter } from 'cli/lib/api';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { linkPulledPreview } from 'cli/lib/cli-config/snapshots';
import { disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getStandingPreviews, type StandingPreview } from 'cli/lib/preview-sites';
import { canUseExistingCore } from 'cli/lib/pull/local-core';
import {
	applySelection,
	type CliSelectionOptions,
	parsePullSyncOptions,
	pullSelectionFromSyncOptions,
	clearPullSelection,
	isFullPull,
	type PullSelection,
} from 'cli/lib/pull/pull-selection';
import { getPullSession, type PullSession, updateSiteRecord } from 'cli/lib/pull/pull-session';
import {
	getReprintApiUrlForSite,
	normalizeSiteUrl,
	type PullSource,
	resolveSourceSite,
} from 'cli/lib/pull/pull-source';
import { savePulledSiteStartOptions, startPulledSite } from 'cli/lib/pull/pulled-site-server';
import { getPushSizeWarning } from 'cli/lib/pull/push-size-warning';
import {
	type ReprintProcessResult,
	runReprintCommandUntilComplete,
} from 'cli/lib/pull/reprint-client';
import { ensureReprintKey } from 'cli/lib/pull/reprint-key';
import {
	getReprintMetadata,
	emptyReprintMetadata,
	type ReprintMetadata,
} from 'cli/lib/pull/reprint-metadata';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { withSiteOperation } from 'cli/lib/site-operations';
import { buildAutoLoginUrl } from 'cli/lib/site-utils';
import { getSiteVersion } from 'cli/lib/site-versions';
import { exitOnCancel, reportSyncActivity } from 'cli/lib/sync-activity';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { findFailureCode } from 'cli/lib/utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import type { SyncFailurePhase } from '@studio/common/lib/sync/classify-sync-failure';
import type { SyncSite } from '@studio/common/types/sync';
import type { builder } from 'cli/commands/pull.command';
import type { CommandArgs } from 'cli/types';

const logger = new Logger< LoggerAction >();
export async function commandHandler( argv: CommandArgs< typeof builder > ) {
	const verbose = argv.verbose;
	exitOnCancel();

	try {
		await runCommand(
			argv.path,
			argv.remoteSite,
			verbose,
			// The app and the agent describe what to pull with `--options`.
			argv.options
				? pullSelectionFromSyncOptions(
						parsePullSyncOptions( argv.options, argv.only as string[] | undefined )
				  )
				: {
						only: argv.only as string[] | undefined,
						skipDatabase: argv[ 'skip-database' ] as boolean,
						skipFiles: argv[ 'skip-files' ] as boolean,
				  }
		);
		// The pulled site's server keeps handles open.
		process.exit( 0 );
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
}

/**
 * The source site's standing preview, or null when it is not one of the user's previews. Undefined
 * when previews could not be listed: that is not worth failing a pull over.
 */
async function findPreview( source: PullSource ): Promise< StandingPreview | null | undefined > {
	try {
		const previews = await getStandingPreviews( source.wpComToken.accessToken );
		return previews.get( source.wpComSite.id ) ?? null;
	} catch {
		return undefined;
	}
}

/**
 * Makes a pulled preview this local site's preview, so updating it pushes this site's changes back.
 * Best-effort: the pull has already succeeded.
 *
 * `pulledAt` is when a full pull started, so an edit made on the preview while it ran counts as
 * one the site doesn't have. A partial pull leaves the site and preview in an unknown state.
 */
async function linkPreview(
	localSiteId: string,
	localPath: string,
	source: PullSource,
	preview: StandingPreview,
	pulledAt: number | undefined
): Promise< void > {
	try {
		const sync = pulledAt
			? { versionId: await getSiteVersion( localSiteId, localPath ), syncedAt: pulledAt }
			: undefined;
		await linkPulledPreview(
			localSiteId,
			source.wpComSite.id,
			source.wpComToken.id,
			preview,
			sync
		);
	} catch {
		// The pulled site still works; only the preview link is missing.
	}
}

/** `site_kind` for `studio_sync_pull`: whether the pull came from one of the user's previews. */
function getSiteKind( run: PullRun ): 'preview' | 'site' | 'unknown' {
	if ( run.preview === undefined ) {
		return 'unknown';
	}
	return run.preview ? 'preview' : 'site';
}

/** The connected site this local site was last pulled from, so a repeat `studio pull` needs no site. */
async function lastPulledFrom( localSiteId: string ): Promise< string | undefined > {
	const pulled = ( await getConnectedWpcomSitesForLocalSite( localSiteId ) )
		.filter( ( connected ) => connected.lastPullTimestamp )
		.sort( ( a, b ) =>
			String( b.lastPullTimestamp ).localeCompare( String( a.lastPullTimestamp ) )
		);
	return pulled[ 0 ]?.url;
}

/**
 * Remembers the remote site, so later pushes and pulls, and the Studio app, offer it without
 * picking it again. Best-effort: the pull has already succeeded.
 */
async function rememberConnection( localSiteId: string, remoteSite: SyncSite ): Promise< void > {
	try {
		await addConnectedWpcomSite( localSiteId, { ...remoteSite, localSiteId } );
		await markConnectedWpcomSiteSynced( localSiteId, remoteSite.id, 'pull' );
	} catch ( error ) {
		logger.reportError( new LoggerError( __( 'Failed to save connected site' ), error ), false );
	}
}

/** A failure to reach the remote site, with details shown under `--verbose`. */
class PullError extends LoggerError {
	technicalDetails: string;

	constructor( userMessage: string, technicalDetails: string ) {
		super( userMessage );
		this.technicalDetails = technicalDetails;
	}
}

/** What a pull got to, for the activity and Tracks reports. */
interface PullRun {
	siteId?: string;
	remoteSite?: SyncSite;
	preview?: StandingPreview | null;
	// Shown with the success, e.g. that the site is too big to push back.
	warning?: string;
	localChangesApplied: boolean;
	completed: boolean;
	// The step a failure is attributed to when its error names no cause of its own.
	failurePhase?: SyncFailurePhase;
}

/**
 * Pulls the remote site into the existing Studio site at `localPath`, and
 * reports its progress and outcome to the Studio app and Tracks.
 *
 * Every step is idempotent and Reprint keeps its own progress, so re-running
 * the command resumes an interrupted pull, or runs a delta sync once a full
 * pull has completed.
 */
export async function runCommand(
	localPath: string,
	remoteSite?: string,
	verbose = false,
	cliSelection: CliSelectionOptions = {},
	onProgress?: ( message: string ) => void
): Promise< SyncSite | undefined > {
	const startedAt = Date.now();
	const run: PullRun = { localChangesApplied: false, completed: false };
	let stopReportingProgress = () => {};
	const stopForwardingProgress = onProgress ? logger.observeProgress( onProgress ) : () => false;
	let pullError: unknown;

	try {
		await pullSite( localPath, remoteSite, verbose, cliSelection, run, ( siteId ) => {
			stopReportingProgress = reportPullProgress( siteId, () => run.remoteSite?.id );
		} );
	} catch ( error ) {
		pullError = error;
	} finally {
		stopReportingProgress();
		stopForwardingProgress();
	}

	if ( run.siteId ) {
		await reportSyncActivity(
			run.siteId,
			pullError !== undefined
				? {
						kind: 'error',
						direction: 'pull',
						message: pullError instanceof Error ? pullError.message : String( pullError ),
						localChangesApplied: run.localChangesApplied,
				  }
				: run.completed
				? { kind: 'success', direction: 'pull', warning: run.warning }
				: { kind: 'cancelled', direction: 'pull' }
		);
	}

	// A user who cancels the site picker or the selection emits nothing: cancels aren't failures.
	if ( run.completed || pullError !== undefined ) {
		try {
			await recordTracksEvent( TRACKS_EVENTS.SYNC_PULL, {
				...buildSyncEventProps( {
					startedAt,
					site: run.remoteSite,
					error: pullError,
					hint: { code: findFailureCode( pullError ), phase: run.failurePhase },
				} ),
				site_kind: getSiteKind( run ),
				...getTracksOrigin(),
			} );
		} catch {
			// Best-effort telemetry: never fail the pull over it.
		}
	}

	if ( pullError !== undefined ) {
		throw pullError;
	}
	return run.completed ? run.remoteSite : undefined;
}

/** Forwards the pull's progress to the Studio app. */
function reportPullProgress( siteId: string, getRemoteSiteId: () => number | undefined ) {
	void reportSyncActivity( siteId, { kind: 'pending', direction: 'pull' } );
	let lastMessage = '';
	return logger.observeProgress( ( message, action ) => {
		if ( message === lastMessage ) {
			return;
		}
		lastMessage = message;
		const percent = /\((\d+)%\)/.exec( message )?.[ 1 ];
		void reportSyncActivity( siteId, {
			kind: 'pending',
			direction: 'pull',
			remoteSiteId: getRemoteSiteId(),
			message,
			...( percent ? { progress: Math.min( 100, Number( percent ) ) } : {} ),
			...( action ? { action } : {} ),
		} );
	} );
}

async function pullSite(
	localPath: string,
	remoteSite: string | undefined,
	verbose: boolean,
	cliSelection: CliSelectionOptions,
	run: PullRun,
	onSiteLoaded: ( siteId: string ) => void
): Promise< void > {
	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
	const site = await getSiteByFolder( localPath );
	logger.reportSuccess( __( 'Site loaded' ) );
	run.siteId = site.id;
	onSiteLoaded( site.id );

	const sourceSite = await resolveSourceSite( remoteSite ?? ( await lastPulledFrom( site.id ) ) );
	if ( ! sourceSite ) {
		return;
	}
	run.remoteSite = sourceSite.wpComSite;
	run.failurePhase = 'remote_backup';
	run.preview = await findPreview( sourceSite );
	// Fails early with an "update Jetpack" message on a site that can't export.
	await enableReprintExporter(
		sourceSite.wpComSite.id,
		sourceSite.wpComToken.accessToken,
		verbose
	);

	const { url: sourceSiteUrl } = sourceSite;
	const normalizedRemoteUrl = normalizeSiteUrl( sourceSiteUrl );
	const studioMetadata = getPullSession( site );
	const apiUrl = getReprintApiUrlForSite( normalizedRemoteUrl );

	const isRepull = Boolean( site.importComplete );

	const hadScratch =
		fs.existsSync( studioMetadata.stateDirectory ) &&
		fs.readdirSync( studioMetadata.stateDirectory ).length > 0;

	if ( isRepull ) {
		// The cached preflight from the last pull may be days old.
		fs.rmSync( path.join( studioMetadata.stateDirectory, 'preflight.json' ), { force: true } );
	}

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
		await ensureReprintKey( {
			wpComSiteId: sourceSite.wpComSite.id,
			wpComAccessToken: sourceSite.wpComToken.accessToken,
			apiUrl,
			stateDirectory: studioMetadata.stateDirectory,
			verbose,
		} );
		await runPreflight( studioMetadata, apiUrl, verbose );
		const reprintMetadata = await getReprintMetadata( {
			apiUrl,
			stateDirectory: studioMetadata.stateDirectory,
			verbose,
		} );
		// Asked before the site is marked `pulling`, so cancelling changes nothing.
		const selection = await applySelection( {
			session: studioMetadata,
			isFirstPull: ! site.importComplete || ! reprintMetadata.hasLocalIndex,
			reprintMetadata,
			cli: cliSelection,
			wpComAccessToken: sourceSite.wpComToken.accessToken,
			wpComSiteId: sourceSite.wpComSite.id,
		} );
		if ( ! selection ) {
			console.log( __( 'Cancelled.' ) );
			return;
		}

		await withSiteOperation( site.path, 'import', async () => {
			site.status = 'pulling';
			await updateSiteRecord( site.id, ( record ) => {
				record.status = 'pulling';
			} );

			const pulledAt = isFullPull( selection ) ? Date.now() : undefined;
			await runFullPull(
				studioMetadata,
				apiUrl,
				verbose,
				! isRepull,
				selection,
				reprintMetadata,
				( phase ) => {
					run.failurePhase = phase;
				}
			);

			// The site keeps its own wp-config.php, so point it at the pulled tables.
			const tablePrefix = reprintMetadata.sourceSite.tablePrefix;
			if ( ! selection.skipDatabase && ! tablePrefix ) {
				logger.reportWarning(
					__( 'The remote site did not report its table prefix, so wp-config.php keeps its own.' )
				);
			}
			if ( ! selection.skipDatabase && tablePrefix ) {
				await using command = await runWpCliCommand( site, [
					'config',
					'set',
					'table_prefix',
					tablePrefix,
					'--type=variable',
				] );
				if ( ( await command.response.exitCode ) !== 0 ) {
					logger.reportWarning(
						sprintf(
							/* translators: %s: the remote site's database table prefix */
							__( 'Could not set $table_prefix to "%s" in wp-config.php.' ),
							tablePrefix
						)
					);
				}
			}

			// Makes `studio site start` serve the pulled runtime instead of the blank install.
			logger.reportStart( LoggerAction.CREATE_SITE, `Linking pulled files to "${ site.name }"…` );
			site.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
			await updateSiteRecord( site.id, ( record ) => {
				record.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
			} );
			logger.reportSuccess( `Site "${ site.name }" updated` );
			await rememberConnection( site.id, sourceSite.wpComSite );
			run.warning = await getPushSizeWarning( site.path );
			if ( run.warning ) {
				logger.reportWarning( run.warning );
			}

			// The pulled database has no local admin user, so auto-login needs credentials to create one.
			if ( ! site.adminPassword ) {
				const adminPassword = encodePassword( crypto.randomBytes( 24 ).toString( 'base64url' ) );
				site.adminPassword = adminPassword;
				await updateSiteRecord( site.id, ( record ) => {
					record.adminPassword = adminPassword;
				} );
			}

			const runtimeStartOptions = savePulledSiteStartOptions( studioMetadata );

			// The pull is complete: a failed start below leaves a site that can start again, and the
			// next pull asks again instead of reusing this choice.
			clearPullSelection( studioMetadata );
			site.importComplete = true;
			site.status = 'ready';
			await updateSiteRecord( site.id, ( record ) => {
				record.importComplete = true;
				record.status = 'ready';
			} );
			run.localChangesApplied = true;

			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );

			await startPulledSite( site, logger, runtimeStartOptions, {
				restart: ! isRepull && wasRunning,
			} );
			// After the start, so what WordPress writes as it boots is part of the pulled version.
			if ( run.preview ) {
				await linkPreview( site.id, localPath, sourceSite, run.preview, pulledAt );
			}

			if ( studioMetadata.localUrl ) {
				console.log( '' );
				console.log( `Site "${ site.name }" is ready.` );
				console.log( '' );
				printSiteUrls( studioMetadata.localUrl );
			}

			run.completed = true;
			console.log( '' );
			console.log( `Site "${ site.name }" pulled successfully.` );
			console.log( '' );
			if ( studioMetadata.localUrl ) {
				printSiteUrls( studioMetadata.localUrl );
			}
		} );
	} catch ( error ) {
		if ( site.status === 'pulling' ) {
			site.status = 'pull-failed';
			await updateSiteRecord( site.id, ( record ) => {
				record.status = 'pull-failed';
			} );
		}

		const resumeCommand = [ 'studio pull', `--path "${ localPath }"` ];
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
 * Checks that the remote exporter is reachable. A passing check is cached in
 * `preflight.json` so a resumed pull skips it.
 */
async function runPreflight(
	sessionMetadata: PullSession,
	sourceSiteApiUrl: string,
	verbose = false
): Promise< void > {
	const preflightCachePath = path.join( sessionMetadata.stateDirectory, 'preflight.json' );

	if ( fs.existsSync( preflightCachePath ) ) {
		return;
	}

	logger.reportStart( LoggerAction.PREFLIGHT, __( 'Initiating the migration…' ) );

	let preflightResult: ReprintProcessResult;
	try {
		preflightResult = await runReprintCommandUntilComplete(
			[
				'preflight',
				sourceSiteApiUrl,
				'--no-adaptive',
				`--state-dir=${ sessionMetadata.stateDirectory }`,
				`--fs-root=${ sessionMetadata.rawDirectory }`,
			],
			undefined,
			{ verboseCommands: verbose }
		);
	} catch ( preflightError ) {
		const details =
			preflightError instanceof Error ? preflightError.message : String( preflightError );
		throw new PullError( __( 'Could not connect to the remote site.' ), details );
	}

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

	const versions = {
		wp_version: preflightData.database?.wp?.wp_version || undefined,
		php_version: preflightData.php?.version || undefined,
	};

	fs.writeFileSync( preflightCachePath, JSON.stringify( versions, null, 2 ) + '\n' );
	logger.reportSuccess(
		`Connected – WordPress ${ versions.wp_version || 'unknown' }, PHP ${
			versions.php_version || 'unknown'
		}`
	);
}

/**
 * Pulls the selected files and database into the site directory and
 * generates its runtime configuration. Each step is a separate Reprint
 * command, so a selection can skip the database.
 */
export async function runFullPull(
	metadata: PullSession,
	apiUrl: string,
	verbose: boolean,
	isFirstPull: boolean,
	selection: PullSelection = {},
	reprintMetadata: ReprintMetadata = emptyReprintMetadata,
	onPhase?: ( phase: SyncFailurePhase ) => void
): Promise< void > {
	// The database lives in the pulled wp-content, or in the local one when
	// the remote's location is unknown and the database isn't pulled.
	const contentDir = reprintMetadata.sourceSite.contentDirectory;
	let importedSqlitePath: string;
	if ( contentDir ) {
		importedSqlitePath = path.join(
			metadata.rawDirectory,
			...contentDir.split( '/' ).filter( Boolean ),
			'database',
			'.ht.sqlite'
		);
	} else if ( selection.skipDatabase ) {
		importedSqlitePath = path.join( metadata.sitePath, 'wp-content', 'database', '.ht.sqlite' );
	} else {
		importedSqlitePath = path.join( metadata.rawDirectory, 'wp-content', 'database', '.ht.sqlite' );
	}

	let sqlitePath = importedSqlitePath;
	if ( selection.skipDatabase ) {
		const existingSqlitePath = [
			importedSqlitePath,
			path.join( metadata.sitePath, 'wp-content', 'database', '.ht.sqlite' ),
			path.join( metadata.rawDirectory, 'wp-content', 'database', '.ht.sqlite' ),
		].find( ( candidate ) => fs.existsSync( candidate ) );
		if ( existingSqlitePath ) {
			sqlitePath = existingSqlitePath;
		}
	}

	// A database-only first pull still pulls core even when the site could use its own. Without
	// any pulled files, flat-docroot couldn't set the site up the way it does after other first
	// pulls, with wp-content linked to the pulled copy.
	const pullsCore =
		!! selection.databaseOnly ||
		! canUseExistingCore( metadata.sitePath, reprintMetadata.sourceSite.wordpressVersion );
	const filesArgs = filesSelectionArgs( selection, contentDir, pullsCore );

	const runStep = ( progressLabel: string, args: string[] ) =>
		runReprintCommandUntilComplete( args, ( progress ) => logger.reportProgress( progress ), {
			progressLabel,
			verboseCommands: verbose,
		} );

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Pulling site…' ) );

	if ( ! selection.skipFiles ) {
		const pullFiles = () =>
			runStep( __( 'Pulling files' ), [
				'pull-files',
				apiUrl,
				...filesArgs,
				'--mode=mirror',
				'--no-adaptive',
				`--state-dir=${ metadata.stateDirectory }`,
				`--fs-root=${ metadata.rawDirectory }`,
			] );
		// A mirror deletes the local files the remote doesn't have, the local database among them.
		await ( selection.skipDatabase && sqlitePath.startsWith( metadata.rawDirectory + path.sep )
			? keepingDatabase( path.dirname( sqlitePath ), metadata.stateDirectory, pullFiles )
			: pullFiles() );
	}

	if ( ! selection.skipDatabase ) {
		await runStep( __( 'Pulling database' ), [
			'pull-db',
			apiUrl,
			'--target-engine=sqlite',
			`--target-sqlite-path=${ sqlitePath }`,
			`--new-site-url=${ metadata.localUrl! }`,
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
		] );
	}

	onPhase?.( 'local_import' );

	// A pull without files leaves the layout as it is: the pulled tree has nothing new to link, and
	// it may hold no core, or older core than the site's. A first pull always has files.
	if ( ! selection.skipFiles ) {
		// Keeps the plugins, themes and uploads only the blank install has, which
		// flat-docroot would otherwise replace. Later pulls have nothing to merge.
		if ( isFirstPull ) {
			await runStep( __( 'Merging local content' ), [
				'merge-wp-content',
				apiUrl,
				`--from=${ path.join( metadata.sitePath, 'wp-content' ) }`,
				`--state-dir=${ metadata.stateDirectory }`,
				`--fs-root=${ metadata.rawDirectory }`,
			] );
		}

		// `--force` replaces the blank install's wp-content on a first pull. Without it, a later pull
		// never replaces the site's own files next to core.
		await runStep( __( 'Flattening layout' ), [
			'flat-docroot',
			apiUrl,
			`--flatten-to=${ metadata.sitePath }`,
			`--core-files=${ pullsCore ? 'copy' : 'use-existing' }`,
			...( isFirstPull ? [ '--force' ] : [] ),
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
		] );
	}

	// Last, so it picks up the database credentials pull-db stored. The SQLite
	// target is passed explicitly for pulls that skipped the database.
	await runStep( __( 'Preparing runtime' ), [
		'apply-runtime',
		apiUrl,
		'--runtime=nginx-fpm',
		'--target-engine=sqlite',
		`--target-sqlite-path=${ sqlitePath }`,
		`--output-dir=${ metadata.runtimeDirectory }`,
		`--flat-document-root=${ metadata.sitePath }`,
		`--state-dir=${ metadata.stateDirectory }`,
	] );

	logger.reportSuccess( __( 'Site pulled' ) );
}

/** Reprint's selector for the WordPress core the remote runs, and only that version. */
const WP_CORE = ':wp-core:';

/**
 * The `pull-files` arguments that select what to pull. A full pull never takes the remote's
 * wp-config.php, so the site keeps its own, unless the remote's wp-content location is unknown:
 * then it takes everything.
 */
function filesSelectionArgs(
	selection: PullSelection,
	contentDir: string | null,
	pullsCore: boolean
): string[] {
	const core = pullsCore ? [ WP_CORE ] : [];
	if ( selection.databaseOnly || selection.fileOnlyPaths?.length ) {
		return [ ...core, ...( selection.fileOnlyPaths ?? [] ) ].map(
			( onlyPath ) => `--only=${ onlyPath }`
		);
	}
	if ( ! contentDir ) {
		return [];
	}
	return [ ':wp-content:', ...core ].map( ( selector ) => `--include=${ selector }` );
}

/**
 * Sets the local database directory aside while `run` runs and puts it back after, also when an
 * interrupted pull left it set aside.
 */
async function keepingDatabase(
	databaseDirectory: string,
	stateDirectory: string,
	run: () => Promise< unknown >
): Promise< void > {
	const keptDirectory = path.join( stateDirectory, 'kept-database' );
	const restore = () => {
		if ( fs.existsSync( keptDirectory ) ) {
			fs.rmSync( databaseDirectory, { recursive: true, force: true } );
			fs.mkdirSync( path.dirname( databaseDirectory ), { recursive: true } );
			fs.renameSync( keptDirectory, databaseDirectory );
		}
	};
	restore();
	if ( fs.existsSync( databaseDirectory ) ) {
		fs.renameSync( databaseDirectory, keptDirectory );
	}
	try {
		await run();
	} finally {
		restore();
	}
}

function printSiteUrls( localUrl: string ): void {
	console.log( __( 'Site URL: ' ), buildAutoLoginUrl( localUrl ) );
	console.log(
		__( 'WP Admin: ' ),
		buildAutoLoginUrl( localUrl, new URL( '/wp-admin/', localUrl ).toString() )
	);
	console.log( '' );
}
