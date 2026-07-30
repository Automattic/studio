import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
	type SiteData,
} from 'cli/lib/cli-config/core';
import { clearSiteLatestCliPid, getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	connectToDaemon,
	disconnectFromDaemon,
	killDaemonAndChildren,
} from 'cli/lib/daemon-client';
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
	siteFolder: string
): Promise< void >;
export async function runCommand(
	target: Mode.STOP_ALL_SITES,
	siteFolder: undefined
): Promise< void >;
export async function runCommand( target: Mode, siteFolder: string | undefined ): Promise< void > {
	try {
		await connectToDaemon();

		if ( target === Mode.STOP_SINGLE_SITE && siteFolder ) {
			const site = await getSiteByFolder( siteFolder );

			const runningProcess = await isServerRunning( site.id );
			if ( ! runningProcess ) {
				logger.reportSuccess( __( 'WordPress server is not running' ) );
				return;
			}

			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );

			try {
				await stopWordPressServer( site.id );
				await clearSiteLatestCliPid( site.id );
				logger.reportSuccess( __( 'WordPress server stopped' ) );
				await stopProxyIfNoSitesNeedIt( site.id, logger );
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to stop WordPress server' ), error );
			}
		} else {
			const cliConfig = await readCliConfig();
			const runningSites: SiteData[] = [];

			for ( const site of cliConfig.sites ) {
				const runningProcess = await isServerRunning( site.id );

				if ( runningProcess ) {
					runningSites.push( site );
				}
			}

			if ( ! runningSites.length ) {
				await killDaemonAndChildren();
				logger.reportSuccess( __( 'No sites are currently running' ) );
			} else {
				try {
					await lockCliConfig();
					const cliConfig = await readCliConfig();
					for ( const site of cliConfig.sites ) {
						if ( runningSites.find( ( r ) => r.id === site.id ) ) {
							delete site.latestCliPid;
						}
					}
					await saveCliConfig( cliConfig );
				} finally {
					await unlockCliConfig();
				}

				logger.reportStart( LoggerAction.STOP_ALL_SITES, __( 'Stopping all WordPress servers…' ) );

				await killDaemonAndChildren();
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
			}
		}
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'stop',
		describe: __( 'Stop site(s)' ),
		builder: ( yargs ) => {
			return yargs.option( 'all', {
				type: 'boolean',
				describe: __( 'Stop all sites' ),
				default: false,
			} );
		},
		handler: async ( argv ) => {
			try {
				if ( argv.all ) {
					await runCommand( Mode.STOP_ALL_SITES, undefined );
				} else {
					await runCommand( Mode.STOP_SINGLE_SITE, argv.path );
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
