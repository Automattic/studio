/**
 * The archive engine behind `studio pull`: it imports a WordPress.com site's Jetpack Backup, unless
 * `STUDIO_ENABLE_PULL_REPRINT` selects the Reprint pull in `./pull`, and the archive a provider
 * that sends the site writes (`pullArchive`), such as a site over SSH.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import { formatProgressLabel } from '@studio/common/lib/progress-label';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { rememberRemoteSite } from '@studio/common/lib/remote-sites';
import {
	buildSyncEventProps,
	classifySyncSelection,
} from '@studio/common/lib/sync/build-sync-event-props';
import {
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { withRemoteEnvironment } from '@studio/common/lib/sync/remote-environment';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import {
	getProvider,
	parseRemoteSite,
	type ProviderSites,
	type SitesProviderId,
} from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { clearSiteLatestCliPid, getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { DEFAULT_IMPORTER_OPTIONS, getImporter } from 'cli/lib/import-export/import/import-manager';
import { confirm } from 'cli/lib/prompts';
import { withSiteOperation } from 'cli/lib/site-operations';
import { getSiteVersion } from 'cli/lib/site-versions';
import { exitOnCancel, reportSyncActivity } from 'cli/lib/sync-activity';
import {
	backupRemoteSite,
	downloadBackup,
	fetchSyncableSites,
	toLoggerError,
} from 'cli/lib/sync-api';
import { fetchPullTree, selectSyncItemsForPull } from 'cli/lib/sync-selector';
import {
	findSyncSiteByIdentifier,
	pickSyncSite,
	resolveFormConnectedSite,
} from 'cli/lib/sync-site-picker';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { findFailureCode } from 'cli/lib/utils';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { handleImportEvents } from './import';
import type {
	SyncEventProps,
	SyncSelectionProps,
} from '@studio/common/lib/sync/build-sync-event-props';
import type { SyncFailurePhase } from '@studio/common/lib/sync/classify-sync-failure';
import type { PullSyncOptions, SyncOption } from '@studio/common/types/sync';
import type { builder } from 'cli/commands/pull.command';
import type { CommandArgs } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

type PulledSite = ProviderSites[ SitesProviderId ];

// Download (0-80%) → Import (80-100%)
async function pullProviderArchive(
	provider: SitesProviderId,
	remoteSite: PulledSite,
	options: PullSyncOptions,
	folder: string,
	logger: Logger< LoggerAction >
): Promise< string > {
	const destPath = path.join( folder, 'pull.tar' );
	const label = __( 'Downloading site…' );
	let reported = formatProgressLabel( label, 0 );
	logger.reportStart( LoggerAction.DOWNLOAD, reported );
	try {
		await getProviderServices( provider ).sites!.pullArchive!(
			await readProviderConfig( provider ),
			remoteSite,
			options,
			Writable.toWeb( fs.createWriteStream( destPath ) ),
			( percent ) => {
				const progress = formatProgressLabel( label, percent * 0.8 );
				if ( progress !== reported ) {
					reported = progress;
					logger.reportProgress( progress );
				}
			}
		);
	} catch ( error ) {
		throw toLoggerError( error, __( 'Failed to download the site' ) );
	}
	return destPath;
}

// Pull progress: Backup (0-50%) → Download (50-80%) → Import (80-100%). Undefined when the user
// backs out of a backup too large to push back.
async function fetchWpcomBackup(
	accessToken: string,
	remoteSiteId: number,
	options: PullSyncOptions,
	folder: string,
	logger: Logger< LoggerAction >,
	confirmLargeBackup?: () => Promise< boolean >
): Promise< string | undefined > {
	logger.reportStart(
		LoggerAction.INITIATE_BACKUP,
		formatProgressLabel( __( 'Initializing remote backup…' ), 0 )
	);
	const { url: downloadUrl, size: backupFileSize } = await backupRemoteSite(
		accessToken,
		remoteSiteId,
		options,
		( percent ) => {
			logger.reportProgress(
				formatProgressLabel( __( 'Creating remote backup…' ), Math.round( percent * 0.5 ) )
			);
		}
	);

	if ( backupFileSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
		if ( confirmLargeBackup ) {
			logger.spinner.stop();
			if ( ! ( await confirmLargeBackup() ) ) {
				return;
			}
		} else {
			logger.reportWarning(
				sprintf(
					__(
						"Your site's backup exceeds %d GB. Pulling it will prevent you from pushing the site back."
					),
					SYNC_PUSH_SIZE_LIMIT_GB
				)
			);
		}
	}
	logger.reportProgress( formatProgressLabel( __( 'Downloading backup…' ), 50 ) );
	const destPath = path.join( folder, `pull-${ remoteSiteId }-${ Date.now() }.tar.gz` );
	await downloadBackup( downloadUrl, destPath );
	return destPath;
}

export async function runCommand(
	siteFolder: string,
	syncOptions?: SyncOption[],
	siteIdentifier?: string,
	syncIncludePathList?: string[],
	logger: Logger< LoggerAction > = defaultLogger,
	confirmLargeBackup?: () => Promise< boolean >,
	specificSelectionPaths?: string[]
): Promise< PulledSite | undefined > {
	const { provider, identifier } = parseRemoteSite( siteIdentifier );
	let pullError: unknown;
	let selectionProps: SyncSelectionProps | undefined = syncOptions
		? classifySyncSelection( { optionsToSync: syncOptions, specificSelectionPaths } )
		: undefined;
	let restartSiteError: unknown;
	let remoteSite: PulledSite | undefined;
	let pullCompleted = false;
	let siteId: string | undefined;
	let failurePhase: SyncFailurePhase | undefined;
	let stopReportingProgress = () => {};
	const startedAt = Date.now();

	try {
		const token = provider === 'wpcom' ? await requireAuthToken( 'auth' ) : undefined;

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );
		siteId = site.id;
		stopReportingProgress = reportPullProgress( site.id, provider, logger, () => remoteSite?.id );

		let optionsToSync: SyncOption[] = syncOptions ?? [ 'all' ];
		let includePathList = syncIncludePathList;
		// Writes the remote site's archive into the folder; undefined when the user backs out.
		let fetchArchive: ( folder: string ) => Promise< string | undefined >;
		if ( provider !== 'wpcom' ) {
			if ( ! getProviderServices( provider ).sites?.pullArchive ) {
				throw new LoggerError(
					sprintf( __( '%s sites can’t be pulled.' ), getProvider( provider ).label )
				);
			}
			const connected = await resolveFormConnectedSite( provider, site.id, identifier, logger );
			remoteSite = connected;
			fetchArchive = ( folder ) =>
				pullProviderArchive(
					provider,
					connected,
					{ optionsToSync, onlyPaths: specificSelectionPaths },
					folder,
					logger
				);
		} else {
			const { accessToken } = token!;
			logger.reportStart( LoggerAction.FETCH_REMOTE_SITES, __( 'Fetching WordPress.com sites…' ) );
			const remoteSites = await fetchSyncableSites( accessToken );
			logger.spinner.stop();

			const wpcomSite = identifier
				? findSyncSiteByIdentifier( remoteSites, identifier )
				: await pickSyncSite( remoteSites, __( 'Select a site to pull from' ) );
			if ( ! wpcomSite ) {
				return;
			}
			remoteSite = wpcomSite;

			if ( ! syncOptions ) {
				logger.reportStart( LoggerAction.FETCH_REMOTE_SITES, __( 'Fetching file tree…' ) );
				const { tree } = await fetchPullTree( accessToken, wpcomSite.id );
				logger.spinner.stop();

				const selection = await selectSyncItemsForPull( accessToken, wpcomSite.id, tree );
				if ( ! selection ) {
					return;
				}
				optionsToSync = selection.optionsToSync;
				includePathList = selection.includePathList;
				specificSelectionPaths = selection.specificSelectionPaths;
			}

			fetchArchive = ( folder ) => {
				failurePhase = 'remote_backup';
				return fetchWpcomBackup(
					accessToken,
					wpcomSite.id,
					{ optionsToSync, includePathList },
					folder,
					logger,
					confirmLargeBackup
				);
			};
		}

		selectionProps ??= classifySyncSelection( { optionsToSync, specificSelectionPaths } );
		const fullPull =
			optionsToSync.includes( 'all' ) &&
			! includePathList?.length &&
			! specificSelectionPaths?.length;

		const tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-sync' ) );

		try {
			const destPath = await fetchArchive( tempDir );
			if ( ! destPath ) {
				return;
			}
			failurePhase = 'local_import';

			await withSiteOperation( site.path, 'import', async () => {
				const wasServerRunning = !! ( await isServerRunning( site.id ) );
				let imported = false;
				try {
					if ( wasServerRunning ) {
						logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
						await stopWordPressServer( site.id );
						await clearSiteLatestCliPid( site.id );
						logger.reportSuccess( __( 'WordPress server stopped' ) );
					}

					const importer = getImporter(
						{ path: destPath, type: 'application/gzip' },
						DEFAULT_IMPORTER_OPTIONS
					);
					handleImportEvents( importer, logger );
					try {
						await importer.import( site );
					} catch ( error ) {
						// Tagged so the failure is attributed to the local import rather than
						// falling back to `unknown` — the remote steps tag themselves in `sync-api`.
						throw new LoggerError( __( 'Failed to import the backup' ), error, 'local_import' );
					}
					imported = true;
				} finally {
					// A full pull starts the site before its version is read, so the version includes what
					// the first start writes, such as the Studio admin user.
					if ( wasServerRunning || ( imported && fullPull ) ) {
						try {
							logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );
							await startWordPressServer( site, logger, 'pull' );
							logger.reportSuccess( __( 'WordPress server started' ) );
						} catch ( error ) {
							restartSiteError = error;
						}
					}
				}
			} );

			// Remember this connection so future push/pull runs (and the Desktop UI)
			// can surface it without re-selecting from the full site list.
			try {
				let localVersionId: string | null = null;
				if ( fullPull ) {
					try {
						localVersionId = await getSiteVersion( site.id, site.path );
					} catch {
						/* The transfer succeeded even if comparison is unavailable. */
					}
				}
				await rememberRemoteSite( provider, site.id, remoteSite, {
					synced: 'pull',
					localVersionId,
				} );
			} catch ( error ) {
				logger.reportError( new LoggerError( 'Failed to save connected site', error ), false );
			}

			pullCompleted = true;
			logger.reportSuccess(
				withRemoteEnvironment(
					sprintf( __( 'Pulled from %1$s (%2$s)' ), remoteSite.name, remoteSite.url ),
					remoteSite
				)
			);
		} finally {
			fs.rmSync( tempDir, { recursive: true, force: true } );
		}
	} catch ( error ) {
		pullError = error;
	} finally {
		stopReportingProgress();
		await disconnectFromDaemon();
	}

	const failure = pullError ?? restartSiteError;
	if ( siteId ) {
		await reportSyncActivity(
			siteId,
			failure !== undefined
				? {
						kind: 'error',
						direction: 'pull',
						provider,
						message: failure instanceof Error ? failure.message : String( failure ),
						localChangesApplied: pullCompleted,
				  }
				: { kind: pullCompleted ? 'success' : 'cancelled', direction: 'pull', provider }
		);
	}

	// Emitted before the restart error is merged below: merging would put a secondary failure at the
	// head of the error chain and mislead the classifier. A user declining the site picker or the
	// size warning returns early without setting either flag, and emits nothing — cancels aren't
	// failures.
	if ( pullCompleted || pullError !== undefined ) {
		await recordSyncPullEvent(
			buildSyncEventProps( {
				startedAt,
				site: remoteSite,
				selection: selectionProps,
				error: pullError,
				hint: { code: findFailureCode( pullError ), phase: failurePhase },
			} )
		);
	}

	// Attach the restart error only when the pull error has no cause of its own — overwriting an
	// existing `previousError` would hide the root cause behind the (secondary) restart failure.
	if (
		pullError instanceof LoggerError &&
		restartSiteError instanceof Error &&
		! pullError.previousError
	) {
		pullError.previousError = restartSiteError;
	}

	if ( pullError instanceof Error ) {
		throw pullError;
	}

	if ( restartSiteError instanceof Error ) {
		throw restartSiteError;
	}

	return pullCompleted ? remoteSite : undefined;
}

function reportPullProgress(
	siteId: string,
	provider: SitesProviderId,
	logger: Logger< LoggerAction >,
	getRemoteSiteId: () => PulledSite[ 'id' ] | undefined
) {
	void reportSyncActivity( siteId, { kind: 'pending', direction: 'pull', provider } );
	let lastMessage = '';
	return logger.observeProgress( ( message, action ) => {
		// The importer reports once per stream chunk; only forward what changes.
		if ( message === lastMessage ) {
			return;
		}
		lastMessage = message;
		const percent = /^(\d+)%/.exec( message )?.[ 1 ];
		void reportSyncActivity( siteId, {
			kind: 'pending',
			direction: 'pull',
			provider,
			remoteSiteId: getRemoteSiteId(),
			message,
			...( percent ? { progress: Math.min( 100, Number( percent ) ) } : {} ),
			...( action ? { action } : {} ),
		} );
	} );
}

async function recordSyncPullEvent( props: SyncEventProps ): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.SYNC_PULL, { ...props, ...getTracksOrigin() } );
	} catch {
		// Best-effort telemetry — never block or fail the pull.
	}
}
export async function commandHandler( argv: CommandArgs< typeof builder > ) {
	exitOnCancel();
	try {
		await runCommand(
			argv.path,
			argv.options as SyncOption[] | undefined,
			argv.remoteSite,
			argv.includePathList as string[] | undefined,
			defaultLogger,
			process.stdin.isTTY
				? () =>
						confirm( {
							message: sprintf(
								__(
									"Your site's backup exceeds %d GB. Pulling it will prevent you from pushing the site back. Do you want to continue?"
								),
								SYNC_PUSH_SIZE_LIMIT_GB
							),
							default: true,
						} )
				: undefined,
			argv.only
		);
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			defaultLogger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Pull failed' ), error );
			defaultLogger.reportError( loggerError );
		}
	}
}
