import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { formatProgressLabel } from '@studio/common/lib/progress-label';
import { rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { getSiteTracksProps } from '@studio/common/lib/site-tracks';
import {
	buildSyncEventProps,
	classifySyncSelection,
} from '@studio/common/lib/sync/build-sync-event-props';
import {
	SYNC_IGNORE_DEFAULTS,
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { SyncOption } from '@studio/common/types/sync';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { ExportOptions } from 'cli/lib/import-export/export/types';
import { withSiteOperation } from 'cli/lib/site-operations';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { exitOnCancel, reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites, toLoggerError, wpcomSites } from 'cli/lib/sync-api';
import { selectSyncItemsForPush } from 'cli/lib/sync-selector';
import { findSyncSiteByIdentifier, pickSyncSite } from 'cli/lib/sync-site-picker';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { findFailureCode } from 'cli/lib/utils';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { handleExportEvents } from './export';
import type {
	SyncEventProps,
	SyncSelectionProps,
} from '@studio/common/lib/sync/build-sync-event-props';
import type { SyncFailurePhase } from '@studio/common/lib/sync/classify-sync-failure';
import type { PushPhase, SyncSite } from '@studio/common/types/sync';
import type { PushStatus } from '@studio/providers';
import type { builder } from 'cli/commands/push.command';
import type { CommandArgs } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

export async function runCommand(
	siteFolder: string,
	syncOptions?: SyncOption[],
	remoteSiteIdentifier?: string,
	logger: Logger< LoggerAction > = defaultLogger,
	{ includeOnly }: PushFlags = {}
): Promise< SyncSite | undefined > {
	const startedAt = Date.now();
	// The remote site is only known part-way through, but the setup steps before
	// it (auth, site load, remote-site fetch) can fail too — `runPush` reports the
	// site back through this ref so those failures are still recorded, just with
	// `sync_type: unknown`.
	const pushed: PushOutcome = {
		selection: syncOptions
			? classifySyncSelection( { optionsToSync: syncOptions, specificSelectionPaths: includeOnly } )
			: undefined,
	};

	try {
		await runPush( siteFolder, syncOptions, includeOnly, remoteSiteIdentifier, logger, pushed );
	} catch ( error ) {
		if ( pushed.siteId ) {
			await reportSyncActivity( pushed.siteId, {
				kind: 'error',
				direction: 'push',
				message: error instanceof Error ? error.message : String( error ),
			} );
		}
		await recordSyncPushEvent(
			siteFolder,
			buildSyncEventProps( {
				startedAt,
				site: pushed.remoteSite,
				selection: pushed.selection,
				error,
				hint: { code: findFailureCode( error ), phase: pushed.failurePhase },
			} )
		);
		throw error;
	}

	if ( pushed.siteId ) {
		await reportSyncActivity( pushed.siteId, {
			kind: pushed.completed ? 'success' : 'cancelled',
			direction: 'push',
		} );
	}
	// Backing out of the site picker or the item selector returns without
	// completing — a cancel, which emits nothing.
	if ( pushed.completed ) {
		await recordSyncPushEvent(
			siteFolder,
			buildSyncEventProps( { startedAt, site: pushed.remoteSite, selection: pushed.selection } )
		);
	}
	return pushed.completed ? pushed.remoteSite : undefined;
}

type PushFlags = { includeOnly?: string[] };
type PushOutcome = {
	selection?: SyncSelectionProps;
	siteId?: string;
	remoteSite?: SyncSite;
	completed?: boolean;
	// The step a failure is attributed to when its error names no cause of its own.
	failurePhase?: SyncFailurePhase;
};

// Each remote step's label, and where it starts and how much it spans of the overall progress.
const PUSH_PROGRESS: Record< PushStatus[ 'phase' ], [ () => string, number, number ] > = {
	uploading: [ () => __( 'Uploading archive…' ), 20, 20 ],
	creatingRemoteBackup: [ () => __( 'Backing up remote site…' ), 40, 20 ],
	applyingChanges: [ () => __( 'Applying changes…' ), 60, 35 ],
	finishing: [ () => __( 'Almost there…' ), 99, 0 ],
};

const FAILURE_PHASES: Record< PushPhase, SyncFailurePhase > = {
	creatingBackup: 'local_export',
	uploading: 'upload',
	creatingRemoteBackup: 'remote_backup',
	applyingChanges: 'remote_import',
	finishing: 'remote_import',
};

async function runPush(
	siteFolder: string,
	syncOptions: SyncOption[] | undefined,
	includeOnly: string[] | undefined,
	remoteSiteIdentifier: string | undefined,
	logger: Logger< LoggerAction >,
	pushed: PushOutcome
): Promise< void > {
	let remoteSite: SyncSite | undefined;

	const token = await requireAuthToken( 'auth' );

	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
	const site = await getSiteByFolder( siteFolder );
	logger.reportSuccess( __( 'Site loaded' ) );
	pushed.siteId = site.id;
	const reportPhase = ( phase?: PushPhase, progress?: number ) => {
		if ( phase ) {
			pushed.failurePhase = FAILURE_PHASES[ phase ];
		}
		void reportSyncActivity( site.id, {
			kind: 'pending',
			direction: 'push',
			remoteSiteId: pushed.remoteSite?.id,
			...( phase ? { phase } : {} ),
			...( progress === undefined ? {} : { progress: Math.round( progress ) } ),
		} );
	};
	reportPhase();

	logger.reportStart(
		LoggerAction.INSTALL_SQLITE,
		__( 'Setting up SQLite integration, if needed…' )
	);
	await keepSqliteIntegrationUpdated( siteFolder );
	logger.reportSuccess( __( 'SQLite integration configured as needed' ) );

	logger.reportStart( LoggerAction.FETCH_REMOTE_SITES, __( 'Fetching WordPress.com sites…' ) );
	const remoteSites = await fetchSyncableSites( token.accessToken );
	logger.spinner.stop();

	if ( remoteSiteIdentifier ) {
		remoteSite = findSyncSiteByIdentifier( remoteSites, remoteSiteIdentifier );
	} else {
		remoteSite = await pickSyncSite( remoteSites, __( 'Select a site to push to' ) );
		if ( ! remoteSite ) {
			return;
		}
	}
	pushed.remoteSite = remoteSite;
	reportPhase();

	let optionsToSync: SyncOption[];
	let specificSelectionPaths: string[] | undefined;

	if ( syncOptions ) {
		optionsToSync = syncOptions;
		specificSelectionPaths = includeOnly;
	} else {
		const selection = await selectSyncItemsForPush( site.path );
		if ( ! selection ) {
			return;
		}
		optionsToSync = selection.optionsToSync;
		specificSelectionPaths = selection.specificSelectionPaths;
	}

	pushed.selection ??= classifySyncSelection( { optionsToSync, specificSelectionPaths } );

	reportPhase( 'creatingBackup' );
	const tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-sync' ) );

	try {
		fs.mkdirSync( tempDir, { recursive: true } );
		const archivePath = path.join( tempDir, `push-${ site.id }-${ Date.now() }.tar.gz` );

		let includes: ExportOptions[ 'includes' ];

		if ( optionsToSync.includes( 'all' ) ) {
			includes = {
				database: true,
				wpContent: true,
			};
		} else {
			includes = {
				database: optionsToSync.includes( 'sqls' ),
				wpContent:
					optionsToSync.includes( 'uploads' ) ||
					optionsToSync.includes( 'plugins' ) ||
					optionsToSync.includes( 'themes' ) ||
					optionsToSync.includes( 'contents' ),
			};
		}

		const deployIgnore = await createDeployIgnoreFilter( site.path, SYNC_IGNORE_DEFAULTS );

		const exporter = await getExporter( {
			site,
			backupFile: archivePath,
			includes,
			phpVersion: site.phpVersion,
			splitDatabaseDumpByTable: true,
			specificSelectionPaths,
			ignoreFilter: deployIgnore,
			stripStudioWpConfigConstants: true,
		} );

		if ( ! exporter ) {
			throw new LoggerError(
				__( 'No suitable exporter found for the provided backup file' ),
				undefined,
				'local_export'
			);
		}

		handleExportEvents( exporter, logger );
		await withSiteOperation( site.path, 'export', () => exporter.export() );

		const archiveSize = fs.statSync( archivePath ).size;
		if ( archiveSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			throw new LoggerError(
				sprintf(
					__(
						'The archive exceeds the %d GB size limit. Please reduce the size of your site and try again.'
					),
					SYNC_PUSH_SIZE_LIMIT_GB
				),
				undefined,
				'size_limit'
			);
		}

		// Push progress: Export (0-20%) → Upload (20-40%) → Remote backup (40-60%) → Import (60-99%) → Done (100%)

		// Suppress DEP0169 warning from tus-js-client's internal use of url.parse()
		const originalEmit = process.emit.bind( process );
		// @ts-expect-error Overriding process.emit to filter deprecation warnings
		process.emit = ( event: string, ...args: unknown[] ) => {
			if ( event === 'warning' && ( args[ 0 ] as { code?: string } )?.code === 'DEP0169' ) {
				return false;
			}
			return ( originalEmit as ( ...a: any[] ) => boolean )( event, ...args );
		};

		const abortUpload = new AbortController();
		let uploading = true;
		let lastReported = '';
		let cancelCount = 0;
		const onSigint = () => {
			cancelCount++;
			if ( cancelCount === 1 ) {
				console.error(
					__( 'Press Ctrl+C again to cancel. The upload cannot be safely cancelled mid-transfer.' )
				);
			} else if ( uploading ) {
				abortUpload.abort( new Error( 'Upload aborted' ) );
				logger.reportError( new LoggerError( __( 'Upload cancelled' ) ) );
			}
		};
		process.on( 'SIGINT', onSigint );

		logger.reportStart(
			LoggerAction.UPLOAD,
			formatProgressLabel( __( 'Uploading archive…' ), 20 )
		);
		try {
			await wpcomSites.push(
				{ token: token.accessToken },
				remoteSite,
				{
					kind: 'archive',
					file: fs.createReadStream( archivePath ),
					name: path.basename( archivePath ),
					size: archiveSize,
				},
				{ optionsToSync, specificSelectionPaths },
				( { phase, progress } ) => {
					const reported = `${ phase }:${ progress === undefined ? '' : Math.round( progress ) }`;
					// The upload reports every chunk; the remote steps report every poll, which a
					// Studio app that restarts or reloads needs to show the push again.
					if ( phase !== 'uploading' || reported !== lastReported ) {
						reportPhase( phase, progress );
					}
					lastReported = reported;
					uploading = phase === 'uploading';
					const [ label, start, span ] = PUSH_PROGRESS[ phase ];
					logger.reportProgress(
						formatProgressLabel( label(), Math.round( start + ( ( progress ?? 0 ) / 100 ) * span ) )
					);
				},
				abortUpload.signal
			);
		} catch ( error ) {
			throw toLoggerError( error, __( 'Push failed' ) );
		} finally {
			process.removeListener( 'SIGINT', onSigint );
			process.emit = originalEmit;
		}

		// Remember this connection so future push/pull runs (and the Desktop UI)
		// can surface it without re-selecting from the full site list.
		try {
			await rememberRemoteSite( 'wpcom', site.id, remoteSite, 'push' );
		} catch ( error ) {
			logger.reportError( new LoggerError( 'Failed to save connected site', error ), false );
		}

		logger.reportSuccess(
			sprintf( __( 'Successfully pushed to %1$s (%2$s)' ), remoteSite.name, remoteSite.url )
		);
		pushed.completed = true;
	} finally {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	}
}

async function recordSyncPushEvent( siteFolder: string, props: SyncEventProps ): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.SYNC_PUSH, {
			...props,
			...( await getSiteTracksProps( { siteFolder } ) ),
			...getTracksOrigin(),
		} );
	} catch {
		// Best-effort telemetry — never block or fail the push.
	}
}
// `spacefast` or `spacefast:<space>` publishes a static export to Spacefast.
const STATIC_REMOTE = /^spacefast(?::(.+))?$/;

export async function commandHandler( argv: CommandArgs< typeof builder > ) {
	exitOnCancel();
	try {
		const staticRemote = argv.remoteSite && STATIC_REMOTE.exec( argv.remoteSite );
		if ( staticRemote ) {
			const { pushStaticSite } = await import( 'cli/lib/static-push' );
			await pushStaticSite( argv.path, staticRemote[ 1 ], defaultLogger );
			return;
		}
		await runCommand( argv.path, argv.options, argv.remoteSite, defaultLogger, {
			includeOnly: argv.includeOnly,
		} );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			defaultLogger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Push failed' ), error );
			defaultLogger.reportError( loggerError );
		}
	}
}
