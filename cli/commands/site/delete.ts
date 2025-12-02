import fs from 'fs/promises';
import { __, _n, sprintf } from '@wordpress/i18n';
import { arePathsEqual } from 'common/lib/fs-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { deleteSnapshot } from 'cli/lib/api';
import {
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
	getAuthToken,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromAppdata, deleteSnapshotFromAppdata } from 'cli/lib/snapshots';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand(
	siteFolder: string,
	deleteFiles: boolean = false
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		const runningProcess = await isServerRunning( site.id );
		if ( runningProcess ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress site...' ) );
			await stopWordPressServer( site.id );
			logger.reportSuccess( __( 'WordPress site stopped' ) );
			await stopProxyIfNoSitesNeedIt( site.id, logger );
		}

		const authToken = await getAuthToken();
		const snapshots = await getSnapshotsFromAppdata( authToken.id, siteFolder );

		if ( snapshots.length > 0 ) {
			logger.reportStart(
				LoggerAction.DELETE_PREVIEW_SITES,
				// translators: %d is the number of associated preview sites
				sprintf(
					_n(
						'Deleting %d associated preview site…',
						'Deleting %d associated preview sites…',
						snapshots.length
					),
					snapshots.length
				)
			);

			for ( const snapshot of snapshots ) {
				await deleteSnapshot( snapshot.atomicSiteId, authToken.accessToken );
				await deleteSnapshotFromAppdata( snapshot.url );
			}

			logger.reportSuccess( __( 'Associated preview sites deleted' ) );
		}

		try {
			await lockAppdata();
			const appdata = await readAppdata();
			const siteIndex = appdata.sites.findIndex( ( s ) => arePathsEqual( s.path, siteFolder ) );
			if ( siteIndex === -1 ) {
				throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
			}
			appdata.sites.splice( siteIndex, 1 );
			await saveAppdata( appdata );
		} finally {
			await unlockAppdata();
		}

		if ( deleteFiles ) {
			logger.reportStart( LoggerAction.DELETE_FILES, __( 'Deleting site files...' ) );
			await fs.rm( siteFolder, { recursive: true, force: true } );
			logger.reportSuccess( __( 'Site files deleted' ) );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete',
		describe: __( 'Delete local site' ),
		builder: ( yargs ) => {
			return yargs.option( 'files', {
				type: 'boolean',
				description: __( 'Also remove site files from disk' ),
				default: false,
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.files );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to delete site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
