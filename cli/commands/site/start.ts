import { __ } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata, updateSiteLatestCliPid } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( siteFolder: string, skipBrowser = false ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const appdata = await readAppdata();
		const site = appdata.sites.find( ( s ) => s.path === siteFolder );

		if ( ! site ) {
			// TODO: Rewrite error message
			throw new LoggerError( __( 'Could not find Studio site.' ) );
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		const runningProcess = await isServerRunning( site.id );
		if ( runningProcess ) {
			logger.reportSuccess( __( 'WordPress site is already running' ) );
			if ( runningProcess.pid ) {
				await updateSiteLatestCliPid( site.id, runningProcess.pid );
			}
			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
			logSiteDetails( site );
			return;
		}

		await setupCustomDomain( site, logger );

		logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress site...' ) );
		try {
			const processDesc = await startWordPressServer( site );

			logger.reportSuccess( __( 'WordPress site started' ) );
			if ( processDesc.pid ) {
				await updateSiteLatestCliPid( site.id, processDesc.pid );
			}
			logSiteDetails( site );

			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to start WordPress server' ), error );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to start site infrastructure' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'start',
		describe: __( 'Start local site' ),
		builder: ( yargs ) => {
			return yargs.option( 'skip-browser', {
				type: 'boolean',
				describe: __( 'Skip opening the site in browser after starting' ),
				default: false,
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.skipBrowser );
		},
	} );
};
