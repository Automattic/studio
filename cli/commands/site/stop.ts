import { __ } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { clearSiteLatestCliPid, getSiteByFolder } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( siteFolder: string ): Promise< void > {
	try {
		const site = await getSiteByFolder( siteFolder );

		await connect();

		const runningProcess = await isServerRunning( site.id );
		if ( ! runningProcess ) {
			logger.reportSuccess( __( 'WordPress site is not running' ) );
			return;
		}

		logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress site...' ) );
		try {
			await stopWordPressServer( site.id );
			await clearSiteLatestCliPid( site.id );
			logger.reportSuccess( __( 'WordPress site stopped' ) );
			await stopProxyIfNoSitesNeedIt( site.id, logger );
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to stop WordPress server' ), error );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'stop',
		describe: __( 'Stop local site' ),
		builder: ( yargs ) => {
			return yargs;
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to load site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
