import { __, _n, sprintf } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { clearSiteLatestCliPid, updateSiteAutoStart } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { ALL_SITES, runOnSites, stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand(
	target: typeof ALL_SITES | string,
	{ autoStart = false }: { autoStart?: boolean } = {}
): Promise< void > {
	const all = target === ALL_SITES;

	try {
		await connect();

		if ( all ) {
			logger.reportStart( LoggerAction.STOP_ALL_SITES, __( 'Stopping all WordPress sites...' ) );
		} else {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress site…' ) );
		}

		const { requested, succeeded, failed } = await runOnSites(
			target,
			async ( site, allSitesToProcess ) => {
				if ( all ) {
					logger.reportProgress(
						sprintf(
							__( 'Stopping site "%s" (%d/%d)…' ),
							site.name,
							allSitesToProcess.indexOf( site ) + 1,
							allSitesToProcess.length
						)
					);
				}

				try {
					await stopWordPressServer( site.id );
					await clearSiteLatestCliPid( site.id );
					await updateSiteAutoStart( site.id, autoStart );
				} catch ( error ) {
					logger.reportError(
						new LoggerError( sprintf( __( 'Failed to stop site %s' ), site.name ) )
					);
					throw error;
				}
			},
			{
				filter: async ( site ) => !! ( await isServerRunning( site.id ) ),
			}
		);

		// Handle logging based on results
		if ( ! all ) {
			if ( ! succeeded.length && ! failed.length ) {
				logger.reportSuccess( __( 'WordPress site is not running' ) );
			} else if ( succeeded.length > 0 ) {
				logger.reportSuccess( __( 'WordPress site stopped' ) );
			}
		} else {
			if ( requested.length === 0 ) {
				logger.reportSuccess( __( 'No sites found' ) );
			} else if ( succeeded.length === 0 && failed.length === 0 ) {
				logger.reportSuccess( __( 'No sites are currently running' ) );
			} else if ( failed.length > 0 && succeeded.length === 0 ) {
				throw new LoggerError( sprintf( __( 'Failed to stop all (%d) sites' ), failed.length ) );
			} else if ( failed.length > 0 ) {
				throw new LoggerError(
					sprintf(
						__( 'Stopped %d sites out of %d' ),
						succeeded.length,
						succeeded.length + failed.length
					)
				);
			} else {
				logger.reportSuccess(
					sprintf(
						_n( 'Successfully stopped %d site', 'Successfully stopped %d sites', succeeded.length ),
						succeeded.length
					)
				);
			}
		}

		// Handle proxy cleanup (should be handled as the last step, to ensure that messages above are logged first)
		const stoppedSiteIds = succeeded.map( ( { site } ) => site.id );
		if ( stoppedSiteIds.length > 0 ) {
			try {
				await stopProxyIfNoSitesNeedIt( stoppedSiteIds, logger );
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to stop proxy server' ), error );
			}
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
				await runCommand( argv.all ? ALL_SITES : argv.path, { autoStart: argv.autoStart } );
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
