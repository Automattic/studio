import { __, _n, sprintf } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	clearSiteLatestCliPid,
	getSiteByFolder,
	readAppdata,
	updateSiteAutoStart,
	type SiteData,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

const filterRunningSites = async ( sites: SiteData[] ): Promise< SiteData[] > => {
	const runningSites = [];

	for ( const site of sites ) {
		const runningProcess = await isServerRunning( site.id );

		if ( runningProcess ) {
			runningSites.push( site );
		}
	}

	return runningSites;
};

export async function runCommand( siteFolder: string, autoStart: boolean ): Promise< void > {
	try {
		const site = await getSiteByFolder( siteFolder );

		await connect();

		const runningProcess = await isServerRunning( site.id );
		if ( ! runningProcess ) {
			logger.reportSuccess( __( 'WordPress site is not running' ) );
			return;
		}

		logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress site…' ) );
		try {
			await stopWordPressServer( site.id );
			await clearSiteLatestCliPid( site.id );
			await updateSiteAutoStart( site.id, autoStart );
			logger.reportSuccess( __( 'WordPress site stopped' ) );
			await stopProxyIfNoSitesNeedIt( site.id, logger );
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to stop WordPress server' ), error );
		}
	} finally {
		disconnect();
	}
}

export async function runCommandAll( autoStart: boolean ): Promise< void > {
	try {
		const appdata = await readAppdata();
		const allSites = appdata.sites;

		if ( ! allSites.length ) {
			logger.reportSuccess( __( 'No sites found' ) );
			return;
		}

		await connect();

		const runningSites = await filterRunningSites( allSites );

		if ( ! runningSites.length ) {
			logger.reportSuccess( __( 'No sites are currently running' ) );
			return;
		}

		const stoppedSiteIds: string[] = [];

		logger.reportStart(
			LoggerAction.STOP_ALL_SITES,
			sprintf(
				__( 'Stopping all WordPress sites... (%d/%d)' ),
				stoppedSiteIds.length,
				runningSites.length
			)
		);

		for ( const site of runningSites ) {
			try {
				logger.reportProgress(
					sprintf(
						__( 'Stopping site "%s" (%d/%d)…' ),
						site.name,
						stoppedSiteIds.length + 1,
						runningSites.length
					)
				);
				await stopWordPressServer( site.id );
				await clearSiteLatestCliPid( site.id );
				await updateSiteAutoStart( site.id, autoStart );

				stoppedSiteIds.push( site.id );
			} catch ( error ) {
				logger.reportError(
					new LoggerError( sprintf( __( 'Failed to stop site %s' ), site.name ) )
				);
			}
		}

		try {
			await stopProxyIfNoSitesNeedIt( stoppedSiteIds, logger );
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to stop proxy server' ), error );
		}

		if ( stoppedSiteIds.length === runningSites.length ) {
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
		} else if ( stoppedSiteIds.length === 0 ) {
			throw new LoggerError(
				sprintf( __( 'Failed to stop all (%d) sites' ), runningSites.length )
			);
		} else {
			throw new LoggerError(
				sprintf( __( 'Stopped %d sites out of %d' ), stoppedSiteIds.length, runningSites.length )
			);
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'stop',
		describe: __( 'Stop local site(s)' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'all', {
					type: 'boolean',
					describe: __( 'Stop all local sites' ),
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
					await runCommandAll( argv.autoStart );
				} else {
					await runCommand( argv.path, argv.autoStart );
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
