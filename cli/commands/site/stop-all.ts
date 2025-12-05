import { __, sprintf } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { clearSiteLatestCliPid, readAppdata, type SiteData } from 'cli/lib/appdata';
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

export async function runCommand(): Promise< void > {
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

		const errors: Array< { siteName: string; error: Error } > = [];

		for ( const site of runningSites ) {
			try {
				await stopWordPressServer( site.id );
				await clearSiteLatestCliPid( site.id );

				stoppedSiteIds.push( site.id );

				logger.reportProgress(
					sprintf(
						__( 'Stopping all WordPress sites... (%d/%d)' ),
						stoppedSiteIds.length,
						runningSites.length
					)
				);
			} catch ( error ) {
				errors.push( {
					siteName: site.name,
					error: error instanceof Error ? error : new Error( String( error ) ),
				} );
			}
		}

		try {
			await stopProxyIfNoSitesNeedIt( stoppedSiteIds, logger );
		} catch ( error ) {
			// Non-critical error, just log it
			logger.reportWarning( __( 'Failed to stop proxy server' ) );
		}

		if ( errors.length === 0 ) {
			const siteNames = runningSites.map( ( s ) => s.name ).join( ', ' );
			logger.reportSuccess(
				sprintf( __( 'Successfully stopped %d site(s): %s' ), runningSites.length, siteNames )
			);
		} else if ( errors.length === runningSites.length ) {
			const failedNames = errors.map( ( e ) => e.siteName ).join( ', ' );
			throw new LoggerError(
				sprintf( __( 'Failed to stop all (%d) sites: %s' ), runningSites.length, failedNames )
			);
		} else {
			const successCount = runningSites.length - errors.length;
			const failedNames = errors.map( ( e ) => e.siteName ).join( ', ' );
			throw new LoggerError(
				sprintf(
					__( 'Stopped %d site(s), but %d failed: %s' ),
					successCount,
					errors.length,
					failedNames
				)
			);
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'stop-all',
		describe: __( 'Stop all local sites' ),
		builder: ( yargs ) => {
			return yargs;
		},
		handler: async () => {
			try {
				await runCommand();
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to stop sites' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
