import { __ } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteByFolder, updateSiteAutoStart, updateSiteLatestCliPid } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand(
	sitePath: string,
	skipBrowser = false,
	skipLogDetails = false
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( sitePath );
		logger.reportSuccess( __( 'Site loaded' ) );

		const runningProcess = await isServerRunning( site.id );
		if ( runningProcess ) {
			logger.reportSuccess( __( 'WordPress server is already running' ) );
			if ( runningProcess.pid ) {
				await updateSiteLatestCliPid( site.id, runningProcess.pid );
			}
			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
			if ( ! skipLogDetails ) {
				logSiteDetails( site );
			}
			return;
		}

		await setupCustomDomain( site, logger );

		logger.reportStart(
			LoggerAction.INSTALL_SQLITE,
			__( 'Setting up SQLite integration, if needed…' )
		);
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured as needed' ) );

		logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );
		try {
			const processDesc = await startWordPressServer( site, logger );

			logger.reportSuccess( __( 'WordPress server started' ) );
			if ( processDesc.pid ) {
				await updateSiteLatestCliPid( site.id, processDesc.pid );
			}
			await updateSiteAutoStart( site.id, true );

			if ( ! skipLogDetails ) {
				logSiteDetails( site );
			}

			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to start WordPress server' ), error );
		}
	} finally {
		await disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'start',
		describe: __( 'Start site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'skip-browser', {
					type: 'boolean',
					describe: __( 'Skip opening the site in browser after starting' ),
					default: false,
				} )
				.option( 'skip-log-details', {
					type: 'boolean',
					describe: __( 'Skip logging default wp-admin user details after starting' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.skipBrowser, argv.skipLogDetails );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to start site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
