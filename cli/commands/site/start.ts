import { __ } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata } from 'cli/lib/appdata';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { addDomainToHosts } from 'cli/lib/hosts-file';
import {
	startDaemon,
	isProxyProcessRunning,
	startProxyProcess,
	disconnect,
} from 'cli/lib/pm2-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

async function startProxyIfNeeded( logger: Logger< LoggerAction > ) {
	const isProxyRunning = await isProxyProcessRunning();
	if ( ! isProxyRunning ) {
		logger.reportStart( LoggerAction.START_PROXY, __( 'Starting HTTP proxy server...' ) );
		await startProxyProcess();
		logger.reportSuccess( __( 'HTTP proxy server started' ) );
	} else {
		logger.reportSuccess( __( 'HTTP proxy already running' ) );
	}
}

export async function runCommand( siteFolder: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const appdata = await readAppdata();
		const site = appdata.sites.find( ( s ) => s.path === siteFolder );

		if ( ! site ) {
			// TODO: Rewrite error message
			throw new LoggerError( __( 'Could not find Studio site.' ) );
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting PM2 daemon...' ) );
		await startDaemon();
		logger.reportSuccess( __( 'PM2 daemon started' ) );

		if ( site.customDomain ) {
			await startProxyIfNeeded( logger );

			if ( site.enableHttps && ( ! site.tlsKey || ! site.tlsCert ) ) {
				logger.reportStart( LoggerAction.GENERATE_CERT, __( 'Generating SSL certificates...' ) );
				await generateSiteCertificate( site.customDomain );
				logger.reportSuccess( __( 'SSL certificates generated' ) );
			}

			logger.reportStart(
				LoggerAction.ADD_DOMAIN_TO_HOSTS,
				__( 'Adding domain to hosts file...' )
			);
			try {
				await addDomainToHosts( site.customDomain, site.port );
				logger.reportSuccess( __( 'Domain added to hosts file' ) );
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to add domain to hosts file:' ), error );
			}
		}

		logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress site...' ) );
		logger.reportSuccess( __( 'WordPress site started (TODO: actual implementation)' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to start site infrastructure' ), error );
			logger.reportError( loggerError );
		}
		process.exit( 1 );
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'start',
		describe: __( 'Start local site' ),
		handler: async ( argv ) => {
			await runCommand( argv.path );
		},
	} );
};
