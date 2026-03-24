import os from 'os';
import path from 'path';
import { SYNC_EVENTS } from '@studio/common/lib/cli-events';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import {
	fetchSyncableSites,
	initiateBackup,
	pollBackupStatus,
	downloadBackup,
} from 'cli/lib/sync-api';
import { selectSyncItemsForPull } from 'cli/lib/sync-selector';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncOption } from '@studio/common/types/sync';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200;

const VALID_OPTIONS: SyncOption[] = [ 'all', 'sqls', 'uploads', 'plugins', 'themes', 'contents' ];

function parseOptions( optionsString?: string ): SyncOption[] {
	if ( ! optionsString ) {
		return [ 'all' ];
	}

	const options = optionsString.split( ',' ).map( ( o ) => o.trim() ) as SyncOption[];
	for ( const option of options ) {
		if ( ! VALID_OPTIONS.includes( option ) ) {
			throw new LoggerError(
				sprintf(
					__( 'Invalid sync option: %s. Valid options: %s' ),
					option,
					VALID_OPTIONS.join( ', ' )
				)
			);
		}
	}

	return options;
}

export async function runCommand( siteFolder: string, optionsString?: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		const site = await getSiteByFolder( siteFolder );

		logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching WordPress.com sites…' ) );
		const sites = await fetchSyncableSites( token.accessToken );
		logger.spinner.stop();
		logger.reportSuccess( sprintf( __( 'Found %d sites' ), sites.length ), true );

		const selectedSite = await pickSyncSite( sites, __( 'Select a site to pull from' ) );
		if ( ! selectedSite ) {
			return;
		}

		let optionsToSync: SyncOption[];
		let includePathList: string[] | undefined;

		if ( optionsString ) {
			optionsToSync = parseOptions( optionsString );
		} else {
			logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching file tree…' ) );
			const selection = await selectSyncItemsForPull( token.accessToken, selectedSite.id );
			logger.spinner.stop();
			optionsToSync = selection.optionsToSync;
			includePathList = selection.includePathList;
		}

		void emitCliEvent( {
			event: SYNC_EVENTS.STARTED,
			data: {
				event: SYNC_EVENTS.STARTED,
				type: 'pull',
				localSiteId: site.id,
				remoteSiteId: selectedSite.id,
				remoteSiteName: selectedSite.name,
			},
		} );

		// Pull progress: Backup (0-50%) → Download (50-80%) → Import (80-100%)
		logger.reportStart(
			LoggerAction.INITIATE_BACKUP,
			sprintf( __( 'Initializing remote backup… (%d%%)' ), 0 )
		);
		const backupId = await initiateBackup( token.accessToken, selectedSite.id, {
			optionsToSync,
			includePathList,
		} );

		let downloadUrl: string | null = null;
		for ( let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++ ) {
			const status = await pollBackupStatus( token.accessToken, selectedSite.id, backupId );

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
					localSiteId: site.id,
					remoteSiteId: selectedSite.id,
					remoteSiteName: selectedSite.name,
					progress: backupProgress,
					statusMessage: __( 'Creating backup…' ),
				},
			} );

			await new Promise( ( resolve ) => setTimeout( resolve, POLL_INTERVAL_MS ) );
		}

		if ( ! downloadUrl ) {
			throw new LoggerError( __( 'Backup timed out' ) );
		}

		// Download phase: 50-80%
		logger.spinner.text = sprintf( __( 'Downloading backup… (%d%%)' ), 50 );
		const tempDir = path.join( os.tmpdir(), 'studio-sync' );
		const { mkdirSync } = await import( 'fs' );
		mkdirSync( tempDir, { recursive: true } );
		const destPath = path.join( tempDir, `pull-${ selectedSite.id }-${ Date.now() }.tar.gz` );
		await downloadBackup( downloadUrl, destPath );

		// TODO: Import backup into local site (80-100%)
		logger.spinner.stop();
		logger.reportSuccess(
			sprintf(
				__( 'Pulled from %s (%s). Backup saved to %s. Import not yet implemented in CLI.' ),
				selectedSite.name,
				selectedSite.url,
				destPath
			)
		);

		void emitCliEvent( {
			event: SYNC_EVENTS.COMPLETED,
			data: {
				event: SYNC_EVENTS.COMPLETED,
				type: 'pull',
				localSiteId: site.id,
				remoteSiteId: selectedSite.id,
				remoteSiteName: selectedSite.name,
			},
		} );
	} catch ( error ) {
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
