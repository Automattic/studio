import { __ } from '@wordpress/i18n';
import { stopSite } from 'common/lib/site-server';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata, saveAppdata, lockAppdata, unlockAppdata } from 'cli/lib/appdata';
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

		if ( ! site.running ) {
			logger.reportSuccess( __( 'Site is already stopped' ) );
			return;
		}

		logger.reportStart( LoggerAction.APPDATA, __( 'Stopping site server…' ) );
		await stopSite( site );

		// Update appdata with stopped state
		site.running = false;
		delete site.pid;
		delete site.url;
		await saveAppdata( appdata );

		logger.reportSuccess( __( 'Site stopped successfully' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to stop site' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		await unlockAppdata();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'stop',
		describe: __( 'Stop a local site' ),
		handler: async ( argv ) => {
			await runCommand( argv.path );
		},
	} );
};
