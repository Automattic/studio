import { __ } from '@wordpress/i18n';
import { arePathsEqual } from 'common/lib/fs-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { clearSiteLatestCliPid, readAppdata } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( siteFolder: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const appdata = await readAppdata();
		const site = appdata.sites.find( ( s ) => arePathsEqual( s.path, siteFolder ) );

		if ( ! site ) {
			throw new LoggerError( __( 'Could not find Studio site.' ) );
		}

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
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to stop site infrastructure' ), error );
			logger.reportError( loggerError );
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
			await runCommand( argv.path );
		},
	} );
};
