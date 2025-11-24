import { __ } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteUrl, SiteData } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { isProxyProcessRunning, startProxyProcess } from 'cli/lib/pm2-manager';
import { Logger } from 'cli/logger';

/**
 * Starts the HTTP proxy server if it's not already running
 */
export async function startProxyIfNeeded( logger: Logger< LoggerAction > ): Promise< void > {
	const proxyProcess = await isProxyProcessRunning();
	if ( ! proxyProcess ) {
		logger.reportStart( LoggerAction.START_PROXY, __( 'Starting HTTP proxy server...' ) );
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
	console.log( __( 'Password: ' ), site.adminPassword );
}
