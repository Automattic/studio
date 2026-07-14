import { decodePassword } from '@studio/common/lib/passwords';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { readCliConfig, SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import {
	isProxyProcessRunning,
	listProcesses,
	startProxyProcess,
	stopProxyProcess,
} from 'cli/lib/daemon-client';
import { addDomainToHosts } from 'cli/lib/hosts-file';
import { isServerRunning, SITE_PROCESS_PREFIX } from 'cli/lib/wordpress-server-manager';
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
 * Builds a `/studio-auto-login` URL for `siteUrl` that lands on
 * `redirectTo` (absolute site URL, or omitted for a bare auto-login).
 * Centralised here so every caller agrees on the query-param shape
 * the studio-auto-login mu-plugin expects.
 */
export function buildAutoLoginUrl(
	runtime: SiteRuntime,
	siteUrl: string,
	redirectTo?: string
): string {
	if ( runtime === SITE_RUNTIME_NATIVE_PHP ) {
		return `${ siteUrl }/`;
	}

	const base = `${ siteUrl }/studio-auto-login`;
	if ( ! redirectTo ) {
		return base;
	}
	return `${ base }?redirect_to=${ encodeURIComponent( redirectTo ) }`;
}

/**
 * Opens the site in the browser with auto-login.
 *
 * If the site was created from a Blueprint with a `landingPage`, that path is
 * used as the redirect target. Otherwise the CLI falls back to `/wp-admin/`,
 * preserving the historical behavior for sites created without one.
 */
export async function openSiteInBrowser( site: SiteData ): Promise< void > {
	const siteUrl = getSiteUrl( site );
	try {
		const targetPath = site.landingPage || '/wp-admin/';
		const target = new URL( targetPath, siteUrl ).toString();
		await openBrowser( buildAutoLoginUrl( getSiteRuntime( site ), siteUrl, target ) );
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
	console.log( __( 'Username: ' ), site.adminUsername || 'admin' );
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

	const cliConfig = await readCliConfig();

	const remainingSitesWithCustomDomains = cliConfig.sites.filter(
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
	const status = await getSitesRunningStatus( [ site ] );
	return status.get( site.id ) ?? false;
};

/**
 * Check running status for multiple sites with a single daemon call.
 */
export async function getSitesRunningStatus(
	sites: SiteData[]
): Promise< Map< string, boolean > > {
	const result = new Map< string, boolean >();

	let processes: Awaited< ReturnType< typeof listProcesses > > = [];
	try {
		processes = await listProcesses();
	} catch {
		// Daemon not running — all sites are stopped.
		for ( const site of sites ) {
			result.set( site.id, false );
		}
		return result;
	}

	for ( const site of sites ) {
		const processName = SITE_PROCESS_PREFIX + site.id;
		const processInfo = processes.find( ( p ) => p.name === processName && p.status === 'online' );
		const running = !! (
			processInfo &&
			'pid' in processInfo &&
			site.latestCliPid !== undefined &&
			processInfo.pid === site.latestCliPid
		);
		result.set( site.id, running );
	}

	return result;
}
