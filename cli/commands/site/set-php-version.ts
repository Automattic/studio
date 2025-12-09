import { SupportedPHPVersions } from '@php-wasm/universal';
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

const ALLOWED_PHP_VERSIONS = [ ...SupportedPHPVersions ];

const logger = new Logger< LoggerAction >();

export async function runCommand(
	sitePath: string,
	phpVersion: ( typeof ALLOWED_PHP_VERSIONS )[ number ]
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( sitePath );
		logger.reportSuccess( __( 'Site loaded' ) );

		if ( site.phpVersion === phpVersion ) {
			throw new LoggerError( __( 'Site is already using the specified PHP version.' ) );
		}

		try {
			await lockAppdata();
			const appdata = await readAppdata();
			const site = appdata.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
			if ( ! site ) {
				throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
			}
			site.phpVersion = phpVersion;
			await saveAppdata( appdata );
		} finally {
			await unlockAppdata();
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		const runningProcess = await isServerRunning( site.id );

		if ( runningProcess ) {
			logger.reportStart( LoggerAction.START_SITE, __( 'Restarting site...' ) );
			await stopWordPressServer( site.id );
			await startWordPressServer( site, logger );
			logger.reportSuccess( __( 'Site restarted' ) );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'set-php-version <php-version>',
		describe: __( 'Set PHP version for a local site' ),
		builder: ( yargs ) => {
			return yargs.positional( 'php-version', {
				type: 'string',
				description: __( 'PHP version' ),
				demandOption: true,
				choices: ALLOWED_PHP_VERSIONS,
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.phpVersion );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to start site infrastructure' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
