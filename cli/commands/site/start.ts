import path from 'path';
import { __ } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { addDomainToHosts } from 'cli/lib/hosts-file';
import {
	isDaemonRunning,
	startDaemon,
	isProxyProcessRunning,
	startProxyProcess,
} from 'cli/lib/pm2-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( siteFolder: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		// Read site details from appdata
		const appdata = await readAppdata();
		const site = [ ...appdata.sites, ...( appdata.newSites ?? [] ) ].find(
			( s ) => s.path === siteFolder
		);

		// Check if proxy is already running
		const isProxyRunning = await isProxyProcessRunning();

		// Start proxy if it's not running yet
		if ( ! isProxyRunning ) {
			// Ensure PM2 daemon is running
			if ( ! isDaemonRunning() ) {
				logger.reportStart( LoggerAction.LOAD, __( 'Starting PM2 daemon...' ) );
				await startDaemon();
				logger.reportSuccess( __( 'PM2 daemon started' ) );
			}

			// Start the HTTP proxy server
			logger.reportStart( LoggerAction.LOAD, __( 'Starting HTTP proxy server...' ) );
			const proxyDaemonPath = path.resolve( __dirname, 'proxy-daemon.js' );
			await startProxyProcess( proxyDaemonPath );
			logger.reportSuccess( __( 'HTTP proxy server started' ) );
		} else {
			logger.reportSuccess( __( 'HTTP proxy already running' ) );
		}

		// If site has a custom domain, handle certificate generation and hosts file
		if ( site?.customDomain && site?.port ) {
			// Generate SSL certificates if HTTPS is enabled and certs don't exist
			if ( site.enableHttps && ( ! site.tlsKey || ! site.tlsCert ) ) {
				logger.reportStart( LoggerAction.LOAD, __( 'Generating SSL certificates...' ) );
				try {
					const { cert, key } = await generateSiteCertificate( site.customDomain );

					// Update site in appdata with the generated certificates
					await lockAppdata();
					try {
						const currentAppdata = await readAppdata();
						const siteIndex = currentAppdata.sites.findIndex( ( s ) => s.id === site.id );
						if ( siteIndex >= 0 ) {
							currentAppdata.sites[ siteIndex ] = {
								...currentAppdata.sites[ siteIndex ],
								tlsKey: key,
								tlsCert: cert,
							};
							await saveAppdata( currentAppdata );
							logger.reportSuccess( __( 'SSL certificates generated' ) );
						}
					} finally {
						await unlockAppdata();
					}
				} catch ( error ) {
					console.error( 'Failed to generate SSL certificates:', error );
					// Continue anyway - site can still work without HTTPS
				}
			}

			// Add domain to /etc/hosts
			logger.reportStart( LoggerAction.LOAD, __( 'Adding domain to hosts file...' ) );
			try {
				await addDomainToHosts( site.customDomain, site.port );
				logger.reportSuccess( __( 'Domain added to hosts file' ) );
			} catch ( error ) {
				console.error( 'Failed to add domain to hosts file:', error );
				// Continue anyway - site can still work without custom domain
			}
		}

		// TODO: Start WordPress site (doesn't require root - uses high ports)
		// This will:
		// - Start WordPress site via PM2 on a high port (8000+)
		// - Register site with proxy server
		logger.reportStart( LoggerAction.LOAD, __( 'Starting WordPress site...' ) );
		logger.reportSuccess( __( 'WordPress site started (TODO: actual implementation)' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to start site infrastructure' ), error );
			logger.reportError( loggerError );
		}
		process.exit( 1 );
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
