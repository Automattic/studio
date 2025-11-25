import { __ } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata, getSiteUrl, SiteData, updateSiteLatestCliPid } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { addDomainToHosts } from 'cli/lib/hosts-file';
import { connect, isProxyProcessRunning, startProxyProcess, disconnect } from 'cli/lib/pm2-manager';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

async function startProxyIfNeeded( logger: Logger< LoggerAction > ) {
	const proxyProcess = await isProxyProcessRunning();
	if ( ! proxyProcess ) {
		logger.reportStart( LoggerAction.START_PROXY, __( 'Starting HTTP proxy server...' ) );
		await startProxyProcess();
		logger.reportSuccess( __( 'HTTP proxy server started' ) );
	} else {
		logger.reportSuccess( __( 'HTTP proxy already running' ) );
	}
}

async function openSiteInBrowser( site: SiteData ) {
	const siteUrl = getSiteUrl( site );
	try {
		const autoLoginUrl = `${ siteUrl }/studio-auto-login?redirect_to=${ encodeURIComponent(
			`${ siteUrl }/wp-admin/`
		) }`;
		await openBrowser( autoLoginUrl );
	} catch ( error ) {
		// Silently fail if browser can't be opened
	}
}

function logSiteDetails( site: SiteData ) {
	const siteUrl = getSiteUrl( site );
	console.log( __( 'Site URL: ' ), siteUrl );
	console.log( __( 'Username: ' ), 'admin' );
	console.log( __( 'Password: ' ), site.adminPassword );
}

export async function runCommand( siteFolder: string, skipBrowser = false ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const appdata = await readAppdata();
		const site = appdata.sites.find( ( s ) => s.path === siteFolder );

		if ( ! site ) {
			// TODO: Rewrite error message
			throw new LoggerError( __( 'Could not find Studio site.' ) );
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		const runningProcess = await isServerRunning( site.id );
		if ( runningProcess ) {
			logger.reportSuccess( __( 'WordPress site is already running' ) );
			if ( runningProcess.pid ) {
				await updateSiteLatestCliPid( site.id, runningProcess.pid );
			}
			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
			logSiteDetails( site );
			return;
		}

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
		try {
			const processDesc = await startWordPressServer( site );

			logger.reportSuccess( __( 'WordPress site started' ) );
			if ( processDesc.pid ) {
				await updateSiteLatestCliPid( site.id, processDesc.pid );
			}
			logSiteDetails( site );

			if ( ! skipBrowser ) {
				await openSiteInBrowser( site );
			}
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to start WordPress server' ), error );
		}
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
		builder: ( yargs ) => {
			return yargs.option( 'skip-browser', {
				type: 'boolean',
				describe: __( 'Skip opening the site in browser after starting' ),
				default: false,
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.skipBrowser );
		},
	} );
};
