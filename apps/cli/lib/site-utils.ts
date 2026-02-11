import { __ } from '@wordpress/i18n';
import { decodePassword } from '@studio/common/lib/passwords';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { getSiteUrl, readAppdata, SiteData } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { addDomainToHosts } from 'cli/lib/hosts-file';
import { isProxyProcessRunning, startProxyProcess, stopProxyProcess } from 'cli/lib/pm2-manager';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

/**
 * Starts the HTTP proxy server if it's not already running
 */
export async function startProxyIfNeeded( logger: Logger< LoggerAction > ): Promise< void > {
	const proxyProcess = await isProxyProcessRunning();
	if ( ! proxyProcess ) {
		logger.reportStart( LoggerAction.START_PROXY, __( 'Starting HTTP proxy server…' ) );
		await startProxyProcess();
		logger.reportSuccess( __( 'HTTP proxy server started' ) );
	} else {
		logger.reportSuccess( __( 'HTTP proxy already running' ) );
	}
}

/**
 * Opens the site in the browser with auto-login to WordPress admin
 */
export async function openSiteInBrowser( site: SiteData ): Promise< void > {
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

/**
 * Logs site details (URL, username, password) to the console
 */
export function logSiteDetails( site: SiteData ): void {
	const siteUrl = getSiteUrl( site );
	console.log( __( 'Site URL: ' ), siteUrl );
	console.log( __( 'Username: ' ), 'admin' );
	if ( site.adminPassword ) {
		console.log( __( 'Password: ' ), decodePassword( site.adminPassword ) );
	}
}

/**
 * Sets up custom domain for a site before starting.
 * Handles proxy server startup, SSL certificate generation, and hosts file configuration.
 *
 * @param options.skipHostsUpdate - Skip adding domain to hosts file (useful when caller already handled it)
 */
export async function setupCustomDomain(
	site: SiteData,
	logger: Logger< LoggerAction >,
	options?: { skipHostsUpdate?: boolean }
): Promise< void > {
	if ( ! site.customDomain ) {
		return;
	}

	await startProxyIfNeeded( logger );

	if ( site.enableHttps && ! site.tlsKey && ! site.tlsCert ) {
		logger.reportStart( LoggerAction.GENERATE_CERT, __( 'Generating SSL certificates…' ) );
		await generateSiteCertificate( site.customDomain );
		logger.reportSuccess( __( 'SSL certificates generated' ) );
	}

	if ( ! options?.skipHostsUpdate ) {
		logger.reportStart( LoggerAction.ADD_DOMAIN_TO_HOSTS, __( 'Adding domain to hosts file…' ) );
		try {
			await addDomainToHosts( site.customDomain, site.port );
			logger.reportSuccess( __( 'Domain added to hosts file' ) );
		} catch ( error ) {
			throw new LoggerError( __( 'Failed to add domain to hosts file' ), error );
		}
	}
}

/**
 * Stops the HTTP proxy server if no remaining running sites need it.
 * A site needs the proxy if it has a custom domain configured.
 *
 * @param stoppedSiteIds - The ID of the site that was just stopped (to exclude from the check)
 */
export async function stopProxyIfNoSitesNeedIt(
	stoppedSiteIds: string | string[],
	logger: Logger< LoggerAction >
): Promise< void > {
	const stoppedSiteIdsArray = Array.isArray( stoppedSiteIds ) ? stoppedSiteIds : [ stoppedSiteIds ];

	const proxyProcess = await isProxyProcessRunning();
	if ( ! proxyProcess ) {
		return;
	}

	const appdata = await readAppdata();

	const remainingSitesWithCustomDomains = appdata.sites.filter(
		( site ) => ! stoppedSiteIdsArray.includes( site.id ) && site.customDomain
	);

	const sitesStillRunning = await Promise.all(
		remainingSitesWithCustomDomains.map( ( site ) => isServerRunning( site.id ) )
	);

	if ( sitesStillRunning.some( ( isRunning ) => isRunning ) ) {
		return;
	}

	logger.reportStart( LoggerAction.STOP_PROXY, __( 'Stopping HTTP proxy server…' ) );
	await stopProxyProcess();
	logger.reportSuccess( __( 'HTTP proxy server stopped' ) );
}

export const isSiteRunning = async ( site: SiteData ): Promise< boolean > => {
	const processInfo = await isServerRunning( site.id );
	return !! (
		processInfo &&
		site.latestCliPid !== undefined &&
		processInfo.pid === site.latestCliPid
	);
};
