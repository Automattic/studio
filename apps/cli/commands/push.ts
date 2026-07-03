import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	addConnectedWpcomSite,
	markConnectedWpcomSiteSynced,
} from '@studio/common/lib/connected-sites';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	SYNC_IGNORE_DEFAULTS,
	SYNC_MAX_STALLED_ATTEMPTS,
	SYNC_POLL_INTERVAL_MS,
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { SyncOption } from '@studio/common/types/sync';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { ExportOptions } from 'cli/lib/import-export/export/types';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import {
	fetchSyncableSites,
	initiateImport,
	parseSyncOptions,
	pollImportStatus,
} from 'cli/lib/sync-api';
import { selectSyncItemsForPush } from 'cli/lib/sync-selector';
import { findSyncSiteByIdentifier, pickSyncSite } from 'cli/lib/sync-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import { handleExportEvents } from './export';

const logger = new Logger< LoggerAction >();

export async function runCommand(
	siteFolder: string,
	syncOptions?: SyncOption[],
	remoteSiteIdentifier?: string
): Promise< void > {
	const token = await readAuthToken();
	if ( ! token ) {
		throw new LoggerError(
			__( 'Authentication required. Please log in with `studio auth login`.' )
		);
	}

	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
	const site = await getSiteByFolder( siteFolder );
	logger.reportSuccess( __( 'Site loaded' ) );

	// The site path is the project folder, not a WordPress install, and the
	// install may contain symlinks into the project.
	if ( site.projectType === 'wp-env' ) {
		throw new LoggerError( __( 'Push is not supported yet for wp-env project sites.' ) );
	}

	logger.reportStart(
		LoggerAction.INSTALL_SQLITE,
		__( 'Setting up SQLite integration, if needed…' )
	);
	await keepSqliteIntegrationUpdated( siteFolder );
	logger.reportSuccess( __( 'SQLite integration configured as needed' ) );

	logger.reportStart( LoggerAction.FETCH_REMOTE_SITES, __( 'Fetching WordPress.com sites…' ) );
	const remoteSites = await fetchSyncableSites( token.accessToken );
	logger.spinner.stop();

	let remoteSite;
	if ( remoteSiteIdentifier ) {
		remoteSite = findSyncSiteByIdentifier( remoteSites, remoteSiteIdentifier );
	} else {
		remoteSite = await pickSyncSite( remoteSites, __( 'Select a site to push to' ) );
		if ( ! remoteSite ) {
			return;
		}
	}

	let optionsToSync: SyncOption[];
	let specificSelectionPaths: string[] | undefined;

	if ( syncOptions ) {
		optionsToSync = syncOptions;
	} else {
		const selection = await selectSyncItemsForPush( site.path );
		if ( ! selection ) {
			return;
		}
		optionsToSync = selection.optionsToSync;
		specificSelectionPaths = selection.specificSelectionPaths;
	}

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
		} );

		if ( ! exporter ) {
			throw new LoggerError( __( 'No suitable exporter found for the provided backup file' ) );
		}

		handleExportEvents( exporter );
		await exporter.export();

		const archiveSize = fs.statSync( archivePath ).size;
		if ( archiveSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			throw new LoggerError(
				sprintf(
					__(
						'The archive exceeds the %d GB size limit. Please reduce the size of your site and try again.'
					),
					SYNC_PUSH_SIZE_LIMIT_GB
				)
			);
		}

		// Push progress: Export (0-20%) → Upload (20-40%) → Remote backup (40-60%) → Import (60-99%) → Done (100%)
		// Export phase skipped when using --archive, so upload starts at 20%

		// Suppress DEP0169 warning from tus-js-client's internal use of url.parse()
		const originalEmit = process.emit.bind( process );
		// @ts-expect-error Overriding process.emit to filter deprecation warnings
		process.emit = ( event: string, ...args: unknown[] ) => {
			if ( event === 'warning' && ( args[ 0 ] as { code?: string } )?.code === 'DEP0169' ) {
				return false;
			}
			return ( originalEmit as ( ...a: any[] ) => boolean )( event, ...args );
		};

		logger.reportStart( LoggerAction.UPLOAD, sprintf( __( 'Uploading archive… (%d%%)' ), 20 ) );
		const { promise: uploadPromise, abort: abortUpload } = createTusUpload( {
			token: token.accessToken,
			remoteSiteId: remoteSite.id,
			archivePath,
			onProgress: ( percent ) => {
				// Upload phase: 20-40%
				const progress = Math.round( 20 + percent * 0.2 );
				logger.reportProgress( sprintf( __( 'Uploading archive… (%d%%)' ), progress ) );
			},
		} );

		let cancelCount = 0;
		const onSigint = () => {
			cancelCount++;
			if ( cancelCount === 1 ) {
				console.error(
					__( 'Press Ctrl+C again to cancel. The upload cannot be safely cancelled mid-transfer.' )
				);
			} else {
				abortUpload();
				logger.reportError( new LoggerError( __( 'Upload cancelled' ) ) );
			}
		};
		process.on( 'SIGINT', onSigint );

		let attachmentId: string;
		try {
			attachmentId = await uploadPromise;
		} finally {
			process.removeListener( 'SIGINT', onSigint );
			process.emit = originalEmit;
		}

		// Initiate import: 40%
		logger.reportProgress( sprintf( __( 'Initiating import… (%d%%)' ), 40 ) );
		await initiateImport( token.accessToken, remoteSite.id, attachmentId, {
			optionsToSync,
			specificSelectionPaths,
		} );

		// Poll import with stale-progress detection
		let lastProgress = -1;
		let stalledAttempts = 0;
		let importFinished = false;

		while ( stalledAttempts < SYNC_MAX_STALLED_ATTEMPTS ) {
			const status = await pollImportStatus( token.accessToken, remoteSite.id );

			if ( status.status === 'failed' ) {
				throw new LoggerError( sprintf( __( 'Import failed on %s' ), remoteSite.name ) );
			}

			if ( status.status === 'finished' ) {
				importFinished = true;
				break;
			}

			let statusMessage: string;
			let progress: number;

			switch ( status.status ) {
				case 'started':
				case 'initial_backup_started':
				case 'initial_backup_finished':
					statusMessage = __( 'Backing up remote site…' );
					progress = 40 + ( ( status.backup_progress ?? 0 ) / 100 ) * 20;
					break;
				case 'archive_import_started':
					statusMessage = __( 'Applying changes…' );
					progress = 60 + ( ( status.import_progress ?? 0 ) / 100 ) * 35;
					break;
				case 'archive_import_finished':
					statusMessage = __( 'Almost there…' );
					progress = 99;
					break;
				default:
					statusMessage = __( 'Applying changes…' );
					progress = 50;
			}

			const roundedProgress = Math.round( progress );
			if ( roundedProgress !== lastProgress ) {
				stalledAttempts = 0;
				lastProgress = roundedProgress;
			} else {
				stalledAttempts++;
			}

			logger.reportProgress( sprintf( '%s (%d%%)', statusMessage, roundedProgress ) );

			await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLL_INTERVAL_MS ) );
		}

		if ( ! importFinished ) {
			throw new LoggerError(
				sprintf( __( 'Import timed out on %s — no progress detected' ), remoteSite.name )
			);
		}

		// Remember this connection so future push/pull runs (and the Desktop UI)
		// can surface it without re-selecting from the full site list.
		try {
			await addConnectedWpcomSite( site.id, { ...remoteSite, localSiteId: site.id } );
			await markConnectedWpcomSiteSynced( site.id, remoteSite.id, 'push' );
		} catch ( error ) {
			logger.reportError( new LoggerError( 'Failed to save connected site', error ), false );
		}

		logger.reportSuccess(
			sprintf( __( 'Successfully pushed to %1$s (%2$s)' ), remoteSite.name, remoteSite.url )
		);
	} finally {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'push',
		describe: __( 'Push your local site to a WordPress.com site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'options', {
					type: 'string',
					description: __(
						'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents'
					),
					coerce: ( val: string | undefined ) =>
						val !== undefined ? parseSyncOptions( val ) : undefined,
				} )
				.option( 'remote-site', {
					type: 'string',
					description: __( 'Remote site URL or ID' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.options, argv.remoteSite );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Push failed' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
