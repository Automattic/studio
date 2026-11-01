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
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { calculateDirectorySizeForArchive } from '@studio/common/lib/fs-utils';
import { encodePassword } from '@studio/common/lib/passwords';
import { buildSyncEventProps } from '@studio/common/lib/sync/build-sync-event-props';
import {
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { PullCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import chalk from 'chalk';
import { enableReprintExporter } from 'cli/lib/api';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { linkPulledPreview } from 'cli/lib/cli-config/snapshots';
import { disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getStandingPreviews, type StandingPreview } from 'cli/lib/preview-sites';
import {
	applySelection,
	type CliSelectionOptions,
	clearPullSelection,
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
import {
	type ReprintProcessResult,
	runReprintCommandUntilComplete,
} from 'cli/lib/pull/reprint-client';
import { ensureReprintKey, reinstallReprintKey, withKeyRecovery } from 'cli/lib/pull/reprint-key';
import {
	getReprintMetadata,
	emptyReprintMetadata,
	type ReprintMetadata,
} from 'cli/lib/pull/reprint-metadata';
import { withSiteOperation } from 'cli/lib/site-operations';
import { buildAutoLoginUrl } from 'cli/lib/site-utils';
import { exitOnCancel, reportSyncActivity } from 'cli/lib/sync-activity';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { findFailureCode } from 'cli/lib/utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
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
			{
				only: argv.only as string[] | undefined,
				skipDatabase: argv[ 'skip-database' ] as boolean,
				skipFiles: argv[ 'skip-files' ] as boolean,
			},
			argv.suppressTracksEvent
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
 */
async function linkPreview(
	localSiteId: string,
	source: PullSource,
	preview: StandingPreview
): Promise< void > {
	try {
		await linkPulledPreview( localSiteId, source.wpComSite.id, source.wpComToken.id, preview );
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

/**
 * Remembers the remote site, so later pushes and pulls, and the Studio app, offer it without
 * picking it again. Best-effort: the pull has already succeeded.
 */
/** The connected site this local site was last pulled from, so a repeat `studio pull` needs no site. */
async function lastPulledFrom( localSiteId: string ): Promise< string | undefined > {
	const pulled = ( await getConnectedWpcomSitesForLocalSite( localSiteId ) )
		.filter( ( connected ) => connected.lastPullTimestamp )
		.sort( ( a, b ) =>
			String( b.lastPullTimestamp ).localeCompare( String( a.lastPullTimestamp ) )
		);
	return pulled[ 0 ]?.url;
}

async function rememberConnection( localSiteId: string, remoteSite: SyncSite ): Promise< void > {
	try {
		await addConnectedWpcomSite( localSiteId, { ...remoteSite, localSiteId } );
		await markConnectedWpcomSiteSynced( localSiteId, remoteSite.id, 'pull' );
	} catch ( error ) {
		logger.reportError( new LoggerError( __( 'Failed to save connected site' ), error ), false );
	}
}

/**
 * Warns when the pulled site looks too big to push back to WordPress.com.
 *
 * Reprint streams the site in pieces, so unlike the Jetpack backup there is no archive size to check
 * before downloading; this measures what landed in wp-content instead. Push uploads a gzipped
 * archive, so the uncompressed tally over-reports, which is why the warning says "may": a false
 * alarm is cheap, a missed one surfaces as a failed push. Goes away when push moves to Reprint.
 */
async function warnIfTooBigToPush( sitePath: string ): Promise< void > {
	try {
		const wpContentSize = await calculateDirectorySizeForArchive(
			path.join( sitePath, 'wp-content' ),
			await createDeployIgnoreFilter( sitePath ),
			'wp-content'
		);
		if ( wpContentSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			logger.reportWarning(
				sprintf(
					__(
						'This site is over %d GB, so pushing it back to WordPress.com may fail. Push a smaller selection with `studio push --include-only`.'
					),
					SYNC_PUSH_SIZE_LIMIT_GB
				)
			);
		}
	} catch {
		// Measuring is advice; the pull has already succeeded.
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
	localChangesApplied: boolean;
	completed: boolean;
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
	suppressTracksEvent = false,
	onProgress?: ( message: string ) => void
): Promise< SyncSite | undefined > {
	const startedAt = Date.now();
	const run: PullRun = { localChangesApplied: false, completed: false };
	let stopReportingProgress = () => {};
	const stopForwardingProgress = onProgress
		? logger.observeProgress( ( message ) => onProgress( message ) )
		: () => false;
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
				: { kind: run.completed ? 'success' : 'cancelled', direction: 'pull' }
		);
	}

	// A user who cancels the site picker or the selection emits nothing: cancels aren't failures.
	if ( ! suppressTracksEvent && ( run.completed || pullError !== undefined ) ) {
		try {
			await recordTracksEvent( TRACKS_EVENTS.SYNC_PULL, {
				...buildSyncEventProps( {
					startedAt,
					site: run.remoteSite,
					error: pullError,
					hint: { code: findFailureCode( pullError ) },
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
	run.preview = await findPreview( sourceSite );
	const exporter = await enableReprintExporter(
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
			exporter,
			apiUrl,
			stateDirectory: studioMetadata.stateDirectory,
			verbose,
		} );
		const reinstallKey = () =>
			reinstallReprintKey( {
				wpComSiteId: sourceSite.wpComSite.id,
				wpComAccessToken: sourceSite.wpComToken.accessToken,
				apiUrl,
				stateDirectory: studioMetadata.stateDirectory,
				verbose,
			} );
		await runPreflight( studioMetadata, apiUrl, verbose, reinstallKey );
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

			run.localChangesApplied = true;
			await runFullPull(
				studioMetadata,
				apiUrl,
				verbose,
				! isRepull,
				selection,
				reprintMetadata,
				reinstallKey
			);

			// Makes `studio site start` serve the pulled runtime instead of the blank install.
			logger.reportStart( LoggerAction.CREATE_SITE, `Linking pulled files to "${ site.name }"…` );
			site.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
			await updateSiteRecord( site.id, ( record ) => {
				record.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
			} );
			logger.reportSuccess( `Site "${ site.name }" updated` );
			if ( run.preview ) {
				await linkPreview( site.id, sourceSite, run.preview );
			}
			await rememberConnection( site.id, sourceSite.wpComSite );
			await warnIfTooBigToPush( site.path );

			// The pulled database has no local admin user, so auto-login needs credentials to create one.
			if ( ! site.adminPassword ) {
				const adminPassword = encodePassword( crypto.randomBytes( 24 ).toString( 'base64url' ) );
				site.adminPassword = adminPassword;
				await updateSiteRecord( site.id, ( record ) => {
					record.adminPassword = adminPassword;
				} );
			}

			const runtimeStartOptions = savePulledSiteStartOptions( studioMetadata );

			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );

			await startPulledSite( site, logger, runtimeStartOptions, {
				restart: ! isRepull && wasRunning,
			} );

			if ( studioMetadata.localUrl ) {
				console.log( '' );
				console.log( `Site "${ site.name }" is ready.` );
				console.log( '' );
				printSiteUrls( studioMetadata.localUrl );
			}

			// So the next pull asks again instead of reusing this choice.
			clearPullSelection( studioMetadata );

			site.importComplete = true;
			site.status = 'ready';
			await updateSiteRecord( site.id, ( record ) => {
				record.importComplete = true;
				record.status = 'ready';
			} );

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
	verbose = false,
	reinstallKey?: () => Promise< void >
): Promise< void > {
	const preflightCachePath = path.join( sessionMetadata.stateDirectory, 'preflight.json' );

	if ( fs.existsSync( preflightCachePath ) ) {
		return;
	}

	logger.reportStart( LoggerAction.PREFLIGHT, __( 'Initiating the migration…' ) );

	let preflightResult: ReprintProcessResult;
	try {
		preflightResult = await withKeyRecovery(
			() =>
				runReprintCommandUntilComplete(
					[
						'preflight',
						sourceSiteApiUrl,
						'--no-adaptive',
						`--state-dir=${ sessionMetadata.stateDirectory }`,
						`--fs-root=${ sessionMetadata.rawDirectory }`,
					],
					undefined,
					{ verboseCommands: verbose }
				),
			reinstallKey
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
 * Writes a minimal wp-config.php when a scoped pull left WordPress without one.
 *
 * On WP Cloud, wp-config.php sits at the document root, outside every
 * `--only` path, so only a dangling symlink to it gets pulled. The runtime
 * already defines the database constants, so the table prefix is all the
 * config needs.
 */
export function ensureScopedPullWpConfig(
	metadata: PullSession,
	reprintMetadata: ReprintMetadata = emptyReprintMetadata
): void {
	const abspath = reprintMetadata.sourceSite.wordpressAbsolutePath;
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
			if ( fs.statSync( candidate ).size > 0 ) {
				return;
			}
		} catch {
			// Missing or a dangling symlink.
		}
	}

	const tablePrefix = reprintMetadata.sourceSite.tablePrefix ?? 'wp_';
	// Escaped for a PHP single-quoted string.
	const escapedTablePrefix = tablePrefix.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
	// Writing through a dangling symlink creates its target.
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
	reinstallKey?: () => Promise< void >
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
	const onlyArgs = ( selection.fileOnlyPaths ?? [] ).map( ( onlyPath ) => `--only=${ onlyPath }` );

	const runStep = ( progressLabel: string, args: string[] ) =>
		withKeyRecovery(
			() =>
				runReprintCommandUntilComplete( args, ( progress ) => logger.reportProgress( progress ), {
					progressLabel,
					verboseCommands: verbose,
				} ),
			reinstallKey
		);

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Pulling site…' ) );

	if ( ! selection.skipFiles ) {
		await runStep( __( 'Pulling files' ), [
			'pull-files',
			apiUrl,
			...onlyArgs,
			'--mode=mirror',
			'--no-adaptive',
			`--state-dir=${ metadata.stateDirectory }`,
			`--fs-root=${ metadata.rawDirectory }`,
		] );
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

	if ( ( selection.fileOnlyPaths ?? [] ).length > 0 ) {
		ensureScopedPullWpConfig( metadata, reprintMetadata );
	}

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

	// `--force` replaces the blank install on a first pull; without it, a delta
	// pull can never overwrite a live site.
	await runStep( __( 'Flattening layout' ), [
		'flat-docroot',
		apiUrl,
		`--flatten-to=${ metadata.sitePath }`,
		...( isFirstPull ? [ '--force' ] : [] ),
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	] );

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

function printSiteUrls( localUrl: string ): void {
	console.log( __( 'Site URL: ' ), buildAutoLoginUrl( localUrl ) );
	console.log(
		__( 'WP Admin: ' ),
		buildAutoLoginUrl( localUrl, new URL( '/wp-admin/', localUrl ).toString() )
	);
	console.log( '' );
}
