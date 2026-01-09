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

		const SITES_TO_TARGET: SiteData[] = [];

		if ( target === Mode.STOP_SINGLE_SITE && siteFolder ) {
			const site = await getSiteByFolder( siteFolder );
			SITES_TO_TARGET.push( site );

			const runningProcess = await isServerRunning( site.id );
			if ( ! runningProcess ) {
				logger.reportSuccess( __( 'WordPress site is not running' ) );
				return;
			}
		} else {
			const appdata = await readAppdata();

			for ( const site of appdata.sites ) {
				const runningProcess = await isServerRunning( site.id );

				if ( runningProcess ) {
					SITES_TO_TARGET.push( site );
				}
			}

			if ( ! SITES_TO_TARGET.length ) {
				logger.reportSuccess( __( 'No sites are currently running' ) );
				return;
			}

			logger.reportStart(
				LoggerAction.STOP_ALL_SITES,
				sprintf( __( 'Stopping all WordPress sites... (%d/%d)' ), 0, SITES_TO_TARGET.length )
			);
		}

		const stoppedSiteIds: string[] = [];

		for ( const site of SITES_TO_TARGET ) {
			try {
				logger.reportProgress(
					sprintf(
						__( 'Stopping site "%s" (%d/%d)…' ),
						site.name,
						stoppedSiteIds.length + 1,
						SITES_TO_TARGET.length
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

		if ( stoppedSiteIds.length === SITES_TO_TARGET.length ) {
			logger.reportSuccess(
				sprintf(
					_n(
						'Successfully stopped %d site',
						'Successfully stopped %d sites',
						SITES_TO_TARGET.length
					),
					SITES_TO_TARGET.length
				)
			);
		} else {
			throw new LoggerError(
				sprintf( __( 'Stopped %d sites out of %d' ), stoppedSiteIds.length, SITES_TO_TARGET.length )
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
