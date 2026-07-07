import fs from 'fs';
import os from 'os';
import path from 'path';
import { confirm } from '@inquirer/prompts';
import {
	addConnectedWpcomSite,
	markConnectedWpcomSiteSynced,
} from '@studio/common/lib/connected-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	SYNC_MAX_STALLED_ATTEMPTS,
	SYNC_POLL_INTERVAL_MS,
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import {
	clearSiteLatestCliPid,
	getSiteByFolder,
	getSiteUrl,
	updateSiteLatestCliPid,
} from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { DEFAULT_IMPORTER_OPTIONS, getImporter } from 'cli/lib/import-export/import/import-manager';
import {
	checkBackupSize,
	fetchSyncableSites,
	initiateBackup,
	parseSyncOptions,
	pollBackupStatus,
	downloadBackup,
} from 'cli/lib/sync-api';
import { fetchPullTree, selectSyncItemsForPull } from 'cli/lib/sync-selector';
import { findSyncSiteByIdentifier, pickSyncSite } from 'cli/lib/sync-site-picker';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import { handleImportEvents } from './import';
import type { SyncOption } from '@studio/common/types/sync';

const logger = new Logger< LoggerAction >();

export async function runCommand(
	siteFolder: string,
	syncOptions?: SyncOption[],
	siteIdentifier?: string
): Promise< void > {
	let site: SiteData | undefined;
	let wasServerRunning = false;
	let pullError: unknown;
	let restartSiteError: unknown;

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		logger.reportStart( LoggerAction.FETCH_REMOTE_SITES, __( 'Fetching WordPress.com sites…' ) );
		const remoteSites = await fetchSyncableSites( token.accessToken );
		logger.spinner.stop();

		let remoteSite;
		if ( siteIdentifier ) {
			remoteSite = findSyncSiteByIdentifier( remoteSites, siteIdentifier );
		} else {
			remoteSite = await pickSyncSite( remoteSites, __( 'Select a site to pull from' ) );
			if ( ! remoteSite ) {
				return;
			}
		}

		let optionsToSync: SyncOption[];
		let includePathList: string[] | undefined;

		if ( syncOptions ) {
			optionsToSync = syncOptions;
		} else {
			logger.reportStart( LoggerAction.FETCH_REMOTE_SITES, __( 'Fetching file tree…' ) );
			const { tree } = await fetchPullTree( token.accessToken, remoteSite.id );
			logger.spinner.stop();

			const selection = await selectSyncItemsForPull( token.accessToken, remoteSite.id, tree );
			if ( ! selection ) {
				return;
			}
			optionsToSync = selection.optionsToSync;
			includePathList = selection.includePathList;
		}

		// Pull progress: Backup (0-50%) → Download (50-80%) → Import (80-100%)
		logger.reportStart(
			LoggerAction.INITIATE_BACKUP,
			sprintf( __( 'Initializing remote backup… (%d%%)' ), 0 )
		);
		const backupId = await initiateBackup( token.accessToken, remoteSite.id, {
			optionsToSync,
			includePathList,
		} );

		let downloadUrl: string | null = null;
		let lastPercent = -1;
		let stalledAttempts = 0;

		while ( stalledAttempts < SYNC_MAX_STALLED_ATTEMPTS ) {
			const status = await pollBackupStatus( token.accessToken, remoteSite.id, backupId );

			if ( status.status === 'failed' ) {
				throw new LoggerError( __( 'Remote backup failed' ) );
			}

			if ( status.status === 'finished' && status.downloadUrl ) {
				downloadUrl = status.downloadUrl;
				break;
			}

			const currentPercent = Math.round( status.percent );
			if ( currentPercent !== lastPercent ) {
				stalledAttempts = 0;
				lastPercent = currentPercent;
			} else {
				stalledAttempts++;
			}

			// Backup phase: 0-50%
			const backupProgress = Math.round( status.percent * 0.5 );
			logger.reportProgress( sprintf( __( 'Creating remote backup… (%d%%)' ), backupProgress ) );

			await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLL_INTERVAL_MS ) );
		}

		if ( ! downloadUrl ) {
			throw new LoggerError( __( 'Backup timed out — no progress detected' ) );
		}

		// Check backup size before downloading
		const backupFileSize = await checkBackupSize( downloadUrl );
		if ( backupFileSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			logger.spinner.stop();
			const shouldContinue = await confirm( {
				message: sprintf(
					__(
						"Your site's backup exceeds %d GB. Pulling it will prevent you from pushing the site back. Do you want to continue?"
					),
					SYNC_PUSH_SIZE_LIMIT_GB
				),
				default: true,
			} );
			if ( ! shouldContinue ) {
				return;
			}
		}

		// Download phase: 50-80%
		logger.reportProgress( sprintf( __( 'Downloading backup… (%d%%)' ), 50 ) );
		const tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-sync' ) );

		try {
			fs.mkdirSync( tempDir, { recursive: true } );
			const destPath = path.join( tempDir, `pull-${ remoteSite.id }-${ Date.now() }.tar.gz` );
			await downloadBackup( downloadUrl, destPath );

			wasServerRunning = !! ( await isServerRunning( site.id ) );

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
			handleImportEvents( importer );
			await importer.import( site );

			// Something in Playground makes it so the front-end of the site sometimes returns an error page
			// on the first request. Send that first request from here to hide the error from the user.
			const siteUrl = getSiteUrl( site );
			await fetch( siteUrl ).catch( () => {} );

			// Remember this connection so future push/pull runs (and the Desktop UI)
			// can surface it without re-selecting from the full site list.
			try {
				await addConnectedWpcomSite( site.id, { ...remoteSite, localSiteId: site.id } );
				await markConnectedWpcomSiteSynced( site.id, remoteSite.id, 'pull' );
			} catch ( error ) {
				logger.reportError( new LoggerError( 'Failed to save connected site', error ), false );
			}

			logger.reportSuccess(
				sprintf( __( 'Pulled from %1$s (%2$s)' ), remoteSite.name, remoteSite.url )
			);
		} finally {
			fs.rmSync( tempDir, { recursive: true, force: true } );
		}
	} catch ( error ) {
		pullError = error;
	} finally {
		try {
			if ( site && wasServerRunning ) {
				logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );
				const processDesc = await startWordPressServer( site, logger );
				if ( processDesc.status === 'online' ) {
					await updateSiteLatestCliPid( site.id, processDesc.pid );
				}
				logger.reportSuccess( __( 'WordPress server started' ) );
			}
		} catch ( error ) {
			restartSiteError = error;
		} finally {
			await disconnectFromDaemon();
		}
	}

	if ( pullError instanceof LoggerError && restartSiteError instanceof Error ) {
		pullError.previousError = restartSiteError;
	}

	if ( pullError instanceof Error ) {
		throw pullError;
	}

	if ( restartSiteError instanceof Error ) {
		throw restartSiteError;
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull',
		describe: __( 'Pull a WordPress.com site to your local site' ),
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
				await runCommand( argv.path, argv.options as SyncOption[] | undefined, argv.remoteSite );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Pull failed' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
