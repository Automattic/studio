import os from 'os';
import path from 'path';
import { confirm } from '@inquirer/prompts';
import { SYNC_EVENTS } from '@studio/common/lib/cli-events';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	SYNC_MAX_POLL_ATTEMPTS,
	SYNC_POLL_INTERVAL_MS,
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import {
	checkBackupSize,
	fetchSyncableSites,
	initiateBackup,
	parseSyncOptions,
	pollBackupStatus,
	downloadBackup,
} from 'cli/lib/sync-api';
import { fetchPullTree, selectSyncItemsForPull } from 'cli/lib/sync-selector';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncOption } from '@studio/common/types/sync';

export async function runCommand( siteFolder: string, optionsString?: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();
	let site: Awaited< ReturnType< typeof getSiteByFolder > > | undefined;
	let selectedSite: Awaited< ReturnType< typeof pickSyncSite > > | undefined;

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		site = await getSiteByFolder( siteFolder );

		logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching WordPress.com sites…' ) );
		const sites = await fetchSyncableSites( token.accessToken );
		logger.spinner.stop();
		logger.reportSuccess( sprintf( __( 'Found %d sites' ), sites.length ), true );

		selectedSite = await pickSyncSite( sites, __( 'Select a site to pull from' ) );
		if ( ! selectedSite ) {
			return;
		}

		let optionsToSync: SyncOption[];
		let includePathList: string[] | undefined;

		if ( optionsString ) {
			optionsToSync = parseSyncOptions( optionsString );
		} else {
			logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching file tree…' ) );
			const { tree } = await fetchPullTree( token.accessToken, selectedSite.id );
			logger.spinner.stop();

			const selection = await selectSyncItemsForPull( token.accessToken, selectedSite.id, tree );
			if ( ! selection ) {
				return;
			}
			optionsToSync = selection.optionsToSync;
			includePathList = selection.includePathList;
		}

		const localSiteId = site.id;
		const remoteSiteId = selectedSite.id;
		const remoteSiteName = selectedSite.name;
		const remoteSiteUrl = selectedSite.url;

		void emitCliEvent( {
			event: SYNC_EVENTS.STARTED,
			data: {
				event: SYNC_EVENTS.STARTED,
				type: 'pull',
				localSiteId,
				remoteSiteId,
				remoteSiteName,
			},
		} );

		// Pull progress: Backup (0-50%) → Download (50-80%) → Import (80-100%)
		logger.reportStart(
			LoggerAction.INITIATE_BACKUP,
			sprintf( __( 'Initializing remote backup… (%d%%)' ), 0 )
		);
		const backupId = await initiateBackup( token.accessToken, remoteSiteId, {
			optionsToSync,
			includePathList,
		} );

		let downloadUrl: string | null = null;
		for ( let attempt = 0; attempt < SYNC_MAX_POLL_ATTEMPTS; attempt++ ) {
			const status = await pollBackupStatus( token.accessToken, remoteSiteId, backupId );

			if ( status.status === 'failed' ) {
				throw new LoggerError( __( 'Remote backup failed' ) );
			}

			if ( status.status === 'finished' && status.downloadUrl ) {
				downloadUrl = status.downloadUrl;
				break;
			}

			// Backup phase: 0-50%
			const backupProgress = Math.round( status.percent * 0.5 );
			logger.spinner.text = sprintf( __( 'Creating remote backup… (%d%%)' ), backupProgress );

			void emitCliEvent( {
				event: SYNC_EVENTS.PROGRESS,
				data: {
					event: SYNC_EVENTS.PROGRESS,
					type: 'pull',
					localSiteId,
					remoteSiteId,
					remoteSiteName,
					progress: backupProgress,
					statusMessage: __( 'Creating backup…' ),
				},
			} );

			await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLL_INTERVAL_MS ) );
		}

		if ( ! downloadUrl ) {
			throw new LoggerError( __( 'Backup timed out' ) );
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
		logger.spinner.text = sprintf( __( 'Downloading backup… (%d%%)' ), 50 );
		const tempDir = path.join( os.tmpdir(), 'studio-sync' );
		const { mkdirSync } = await import( 'fs' );
		mkdirSync( tempDir, { recursive: true } );
		const destPath = path.join( tempDir, `pull-${ remoteSiteId }-${ Date.now() }.tar.gz` );
		await downloadBackup( downloadUrl, destPath );

		// TODO: Import backup into local site (80-100%)
		logger.spinner.stop();
		logger.reportSuccess(
			sprintf(
				__( 'Pulled from %s (%s). Backup saved to %s. Import not yet implemented in CLI.' ),
				remoteSiteName,
				remoteSiteUrl,
				destPath
			)
		);

		void emitCliEvent( {
			event: SYNC_EVENTS.COMPLETED,
			data: {
				event: SYNC_EVENTS.COMPLETED,
				type: 'pull',
				localSiteId,
				remoteSiteId,
				remoteSiteName,
			},
		} );
	} catch ( error ) {
		if ( site && selectedSite ) {
			void emitCliEvent( {
				event: SYNC_EVENTS.FAILED,
				data: {
					event: SYNC_EVENTS.FAILED,
					type: 'pull',
					localSiteId: site.id,
					remoteSiteId: selectedSite.id,
					remoteSiteName: selectedSite.name,
					error: error instanceof Error ? error.message : __( 'Pull failed' ),
				},
			} );
		}

		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Pull failed' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull',
		describe: __( 'Pull a WordPress.com site to your local site' ),
		builder: ( yargs ) => {
			return yargs.option( 'options', {
				type: 'string',
				description: __(
					'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents'
				),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.options );
		},
	} );
};
