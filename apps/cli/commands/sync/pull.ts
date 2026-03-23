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
		const optionsToSync = parseOptions( optionsString );

		logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching WordPress.com sites…' ) );
		const sites = await fetchSyncableSites( token.accessToken );
		logger.reportSuccess( sprintf( __( 'Found %d sites' ), sites.length ), true );

		const selectedSite = await pickSyncSite( sites, __( 'Select a site to pull from' ) );
		if ( ! selectedSite ) {
			return;
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

		logger.reportStart( LoggerAction.INITIATE_BACKUP, __( 'Initiating remote backup…' ) );
		const backupId = await initiateBackup( token.accessToken, selectedSite.id, { optionsToSync } );
		logger.reportSuccess( __( 'Backup initiated' ), true );

		logger.reportStart( LoggerAction.POLL_BACKUP, __( 'Waiting for backup to complete…' ) );
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

			void emitCliEvent( {
				event: SYNC_EVENTS.PROGRESS,
				data: {
					event: SYNC_EVENTS.PROGRESS,
					type: 'pull',
					localSiteId: site.id,
					remoteSiteId: selectedSite.id,
					remoteSiteName: selectedSite.name,
					progress: status.percent,
					statusMessage: __( 'Creating backup…' ),
				},
			} );

			await new Promise( ( resolve ) => setTimeout( resolve, POLL_INTERVAL_MS ) );
		}

		if ( ! downloadUrl ) {
			throw new LoggerError( __( 'Backup timed out' ) );
		}
		logger.reportSuccess( __( 'Backup ready' ), true );

		logger.reportStart( LoggerAction.DOWNLOAD, __( 'Downloading backup…' ) );
		const tempDir = path.join( os.tmpdir(), 'studio-sync' );
		const { mkdirSync } = await import( 'fs' );
		mkdirSync( tempDir, { recursive: true } );
		const destPath = path.join( tempDir, `pull-${ selectedSite.id }-${ Date.now() }.tar.gz` );
		await downloadBackup( downloadUrl, destPath );
		logger.reportSuccess( __( 'Backup downloaded' ), true );

		// TODO: Import backup into local site
		logger.reportStart( LoggerAction.IMPORT, __( 'Importing backup…' ) );
		logger.reportSuccess(
			sprintf( __( 'Backup downloaded to %s. Import not yet implemented in CLI.' ), destPath )
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
