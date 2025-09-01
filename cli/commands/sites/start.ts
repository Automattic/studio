import { confirm } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import { startSite } from 'common/lib/site-server';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata, saveAppdata, lockAppdata, unlockAppdata } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( sitePath: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.LOAD, __( 'Loading site details…' ) );

		await lockAppdata();
		const appdata = await readAppdata();
		const site = appdata.sites.find( ( s ) => s.path === sitePath );
		if ( ! site ) {
			throw new Error( __( 'No site found at this path. Use "studio sites create" first.' ) );
		}
		logger.reportSuccess( __( 'Site details loaded' ) );

		if ( site.running && site.pid ) {
			logger.reportSuccess(
				__( 'Site is already running at ' ) + `http://localhost:${ site.port }`
			);
			return;
		}

		logger.reportStart( LoggerAction.APPDATA, __( 'Starting site server…' ) );

		// Start the site
		const result = await startSite( site );

		// Update appdata with new running state and PID
		site.running = true;
		site.pid = result.pid;
		site.url = `http://localhost:${ site.port }`;
		await saveAppdata( appdata );

		logger.reportSuccess( __( 'Site started successfully at ' ) + site.url );

		const shouldOpenBrowser = await confirm( {
			message: __( 'Would you like to open the site in your browser?' ),
			default: true,
		} );

		if ( shouldOpenBrowser ) {
			await openBrowser( site.url );
			logger.reportSuccess( __( 'Site opened in browser' ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to start site' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		await unlockAppdata();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'start',
		describe: __( 'Start a local site' ),
		handler: async ( argv ) => {
			await runCommand( argv.path );
		},
	} );
};
