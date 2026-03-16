import fs from 'fs';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { readAuthToken, type StoredToken } from '@studio/common/lib/shared-config';
import { SITE_EVENTS } from '@studio/common/lib/site-events';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { deleteSnapshot } from 'cli/lib/api';
import { deleteSiteCertificate } from 'cli/lib/certificate-manager';
import {
	getSiteByFolder,
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config';
import { connectToDaemon, disconnectFromDaemon, emitSiteEvent } from 'cli/lib/daemon-client';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromAppdata, deleteSnapshotFromAppdata } from 'cli/lib/snapshots';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

async function deletePreviewSites( authToken: StoredToken, siteFolder: string ) {
	try {
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

			await Promise.all(
				snapshots.map( async ( snapshot ) => {
					await deleteSnapshot( snapshot.atomicSiteId, authToken.accessToken );
					await deleteSnapshotFromAppdata( snapshot.url );
				} )
			);

			logger.reportSuccess( __( 'Associated preview sites deleted' ) );
		}
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__( 'Failed to delete associated preview sites. Proceeding anyway…' ),
				error
			),
			false
		);
	}
}

export async function runCommand(
	siteFolder: string,
	deleteFiles: boolean = false
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		const runningProcess = await isServerRunning( site.id );
		if ( runningProcess ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
			await stopWordPressServer( site.id );
			logger.reportSuccess( __( 'WordPress server stopped' ) );
			await stopProxyIfNoSitesNeedIt( site.id, logger );
		}

		if ( site.customDomain ) {
			logger.reportStart(
				LoggerAction.REMOVE_DOMAIN_FROM_HOSTS,
				__( 'Removing domain from hosts file…' )
			);
			await removeDomainFromHosts( site.customDomain );
			logger.reportSuccess( __( 'Domain removed from hosts file' ) );

			if ( site.enableHttps ) {
				logger.reportStart( LoggerAction.DELETE_CERT, __( 'Deleting SSL certificates…' ) );
				deleteSiteCertificate( site.customDomain );
				logger.reportSuccess( __( 'SSL certificates deleted' ) );
			}
		}

		const authToken = await readAuthToken();
		if ( authToken ) {
			await deletePreviewSites( authToken, siteFolder );
		}

		try {
			await lockCliConfig();
			const cliConfig = await readCliConfig();
			const siteIndex = cliConfig.sites.findIndex( ( s ) => arePathsEqual( s.path, siteFolder ) );
			if ( siteIndex === -1 ) {
				throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
			}
			cliConfig.sites.splice( siteIndex, 1 );
			await saveCliConfig( cliConfig );
		} finally {
			await unlockCliConfig();
		}

		if ( deleteFiles ) {
			if ( fs.existsSync( siteFolder ) ) {
				logger.reportStart( LoggerAction.DELETE_FILES, __( 'Moving site files to trash…' ) );
				// We configure `trash` as an external module, since it includes a native macOS binary that Vite
				// inlines as a base64 string, which produces a runtime error. Since `trash` is also an ESM-only
				// module, we need to import it dynamically (since Rollup doesn't get a chance to process it)
				const trash = ( await import( 'trash' ) ).default;
				await trash( siteFolder );
				logger.reportSuccess( __( 'Site files moved to trash' ) );
			} else {
				logger.reportSuccess( __( 'Site files already removed' ) );
			}
		}

		await emitSiteEvent( SITE_EVENTS.DELETED, { siteId: site.id } );
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete',
		describe: __( 'Delete site' ),
		builder: ( yargs ) => {
			return yargs.option( 'files', {
				type: 'boolean',
				description: __( 'Also move site files to trash' ),
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
