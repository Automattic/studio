import { __, _n, sprintf } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	clearSiteLatestCliPid,
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
	updateSiteAutoStart,
	type SiteData,
} from 'cli/lib/appdata';
import { connect, disconnect, killDaemonAndAllChildren } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export enum Mode {
	STOP_SINGLE_SITE,
	STOP_ALL_SITES,
}

export async function runCommand(
	target: Mode.STOP_SINGLE_SITE,
	siteFolder: string,
	autoStart: boolean
): Promise< void >;
export async function runCommand(
	target: Mode.STOP_ALL_SITES,
	siteFolder: undefined,
	autoStart: boolean
): Promise< void >;
export async function runCommand(
	target: Mode,
	siteFolder: string | undefined,
	autoStart: boolean
): Promise< void > {
	try {
		await connect();

		if ( target === Mode.STOP_SINGLE_SITE && siteFolder ) {
			const site = await getSiteByFolder( siteFolder );
			const runningProcess = await isServerRunning( site.id );
			if ( ! runningProcess ) {
				logger.reportSuccess( __( 'WordPress server is not running' ) );
				return;
			}

			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress servers…' ) );

			try {
				await stopWordPressServer( site.id );
				await clearSiteLatestCliPid( site.id );
				await updateSiteAutoStart( site.id, autoStart );
				logger.reportSuccess( __( 'WordPress site stopped' ) );
				await stopProxyIfNoSitesNeedIt( site.id, logger );
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to stop WordPress server' ), error );
			}
		} else {
			const appdata = await readAppdata();
			const runningSites: SiteData[] = [];

			for ( const site of appdata.sites ) {
				const runningProcess = await isServerRunning( site.id );

				if ( runningProcess ) {
					runningSites.push( site );
				}
			}

			if ( ! runningSites.length ) {
				logger.reportSuccess( __( 'No sites are currently running' ) );
				return;
			}

			logger.reportStart( LoggerAction.STOP_ALL_SITES, __( 'Stopping all WordPress sites…' ) );
			await killDaemonAndAllChildren();

			try {
				await lockAppdata();
				const appdata = await readAppdata();
				for ( const site of appdata.sites ) {
					if ( runningSites.find( ( r ) => r.id === site.id ) ) {
						delete site.latestCliPid;
						site.autoStart = autoStart;
					}
				}
				await saveAppdata( appdata );
			} finally {
				await unlockAppdata();
			}

			logger.reportSuccess(
				sprintf(
					_n(
						'Successfully stopped %d site',
						'Successfully stopped %d sites',
						runningSites.length
					),
					runningSites.length
				)
			);

			// Calling `pm2.killDaemon` requires us to forcefully exit the process. pm2 does the same
			// thing internally in its CLI.
			process.exit( 0 );
		}
	} finally {
		await disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'stop',
		describe: __( 'Stop site(s)' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'all', {
					type: 'boolean',
					describe: __( 'Stop all sites' ),
					default: false,
				} )
				.option( 'auto-start', {
					type: 'boolean',
					describe: __( 'Set auto-start flag for the site(s)' ),
					default: false,
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				if ( argv.all ) {
					await runCommand( Mode.STOP_ALL_SITES, undefined, argv.autoStart );
				} else {
					await runCommand( Mode.STOP_SINGLE_SITE, argv.path, argv.autoStart );
				}
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError(
						argv.all ? __( 'Failed to stop sites' ) : __( 'Failed to stop site' ),
						error
					);
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
