import { __, sprintf } from '@wordpress/i18n';
import { arePathsEqual } from 'common/lib/fs-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	isXdebugBetaEnabled,
	lockAppdata,
	readAppdata,
	saveAppdata,
	SiteData,
	unlockAppdata,
	updateSiteLatestCliPid,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( sitePath: string, enableXdebug: boolean ): Promise< void > {
	try {
		if ( ! ( await isXdebugBetaEnabled() ) ) {
			throw new LoggerError(
				__( 'Xdebug support is a beta feature. Enable it in Studio settings first.' )
			);
		}

		let site: SiteData;

		try {
			await lockAppdata();
			const appdata = await readAppdata();

			const foundSite = appdata.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
			if ( ! foundSite ) {
				throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
			}

			site = foundSite;

			if ( enableXdebug ) {
				const otherXdebugSite = appdata.sites.find( ( s ) => s.enableXdebug && s.id !== site.id );
				if ( otherXdebugSite ) {
					throw new LoggerError(
						sprintf(
							/* translators: %s: site name */
							__(
								'Only one site can have Xdebug enabled at a time. Disable Xdebug on "%s" first.'
							),
							otherXdebugSite.name
						)
					);
				}
			}

			if ( site.enableXdebug === enableXdebug ) {
				if ( enableXdebug ) {
					throw new LoggerError( __( 'Xdebug is already enabled for this site.' ) );
				} else {
					throw new LoggerError( __( 'Xdebug is already disabled for this site.' ) );
				}
			}

			site.enableXdebug = enableXdebug;
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
			const processDesc = await startWordPressServer( site, logger );
			if ( processDesc.pid ) {
				await updateSiteLatestCliPid( site.id, processDesc.pid );
			}
			logger.reportSuccess( __( 'Site restarted' ) );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'set-xdebug <enable>',
		describe: __( 'Enable or disable Xdebug for a local site' ),
		builder: ( yargs ) => {
			return yargs.positional( 'enable', {
				type: 'boolean',
				description: __( 'Enable Xdebug' ),
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.enable );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to configure Xdebug' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
