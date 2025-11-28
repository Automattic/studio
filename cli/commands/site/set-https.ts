import { __, _n } from '@wordpress/i18n';
import { arePathsEqual } from 'common/lib/fs-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( sitePath: string, enableHttps: boolean ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( sitePath, false );
		logger.reportSuccess( __( 'Site loaded' ) );

		if ( ! site.customDomain ) {
			throw new LoggerError( __( 'Site does not have a custom domain.' ) );
		}

		if ( site.enableHttps === enableHttps ) {
			if ( enableHttps ) {
				throw new LoggerError( __( 'HTTPS is already enabled for this site.' ) );
			} else {
				throw new LoggerError( __( 'HTTPS is already disabled for this site.' ) );
			}
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		try {
			await lockAppdata();
			const appdata = await readAppdata();
			const site = appdata.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
			if ( ! site ) {
				throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
			}
			site.enableHttps = enableHttps;
			await saveAppdata( appdata );
		} finally {
			await unlockAppdata();
		}

		const runningProcess = await isServerRunning( site.id );

		if ( runningProcess ) {
			logger.reportStart( LoggerAction.START_SITE, __( 'Restarting site...' ) );
			await stopWordPressServer( site.id );
			await startWordPressServer( site );
			logger.reportSuccess( __( 'Site restarted' ) );
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
		command: 'set-https <enable>',
		describe: __( 'Set HTTPS for a local site' ),
		builder: ( yargs ) => {
			return yargs.positional( 'enable', {
				type: 'boolean',
				description: __( 'Enable HTTPS' ),
				required: true,
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, !! argv.enable );
		},
	} );
};
