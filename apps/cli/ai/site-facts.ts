import { describeSavedCopies, readSavedCopies } from 'cli/ai/saved-copies';
import { readOptions, readSiteDatabase, type SiteDatabase } from 'cli/ai/site-database';
import { describeWpcomSiteCapabilities, getWpcomSiteCapabilities } from 'cli/ai/wpcom-capabilities';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import type { SiteInfo } from 'cli/ai/types';

// WooCommerce's Coming soon mode, read from the options WooCommerce reads
// (src/Internal/ComingSoon/ComingSoonHelper.php). Logged-out visitors, and so
// screenshots and fetches of the site, get the Coming soon page.
function describeComingSoon( db: SiteDatabase, prefix: string ): string | undefined {
	const options = readOptions( db, prefix, [
		'active_plugins',
		'woocommerce_coming_soon',
		'woocommerce_store_pages_only',
	] );
	if (
		options.woocommerce_coming_soon !== 'yes' ||
		! options.active_plugins?.includes( '"woocommerce/woocommerce.php"' )
	) {
		return undefined;
	}
	const pages = options.woocommerce_store_pages_only === 'yes' ? 'its store pages' : 'the site';
	return `WooCommerce's Coming soon mode is on (woocommerce_coming_soon): visitors who are not logged in, including screenshots, get a Coming soon page instead of ${ pages }.`;
}

/**
 * Facts about the local site at `sitePath`, one line each, read from its own
 * files and database: the WordPress version it runs, the copies saved in the
 * Site Editor that WordPress renders instead of theme files, and whether
 * visitors see a Coming soon page.
 */
export async function readSiteFacts( sitePath: string ): Promise< string[] > {
	const [ version, fromDatabase ] = await Promise.all( [
		getWordPressVersionFromInstallation( sitePath ),
		readSiteDatabase( sitePath, ( db, prefix ) => [
			describeSavedCopies( readSavedCopies( db, prefix ) ),
			describeComingSoon( db, prefix ),
		] ),
	] );
	return [ version && `WordPress ${ version }.`, ...( fromDatabase ?? [] ) ].filter(
		( fact ): fact is string => Boolean( fact )
	);
}

/**
 * Facts about the active site for the Active site section: a local site's
 * own facts, or what a WordPress.com site's plan and the user's role allow.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[] > {
	if ( ! site ) {
		return [];
	}
	if ( site.remote ) {
		const capabilities = site.wpcomSiteId
			? await getWpcomSiteCapabilities( site.wpcomSiteId )
			: undefined;
		return capabilities ? [ `${ describeWpcomSiteCapabilities( capabilities ) }.` ] : [];
	}
	return readSiteFacts( site.path );
}
