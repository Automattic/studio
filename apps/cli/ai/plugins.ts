import type { WordPressSite } from 'cli/ai/site-database';

// The plugins WordPress loads (the active_plugins option), by plugin file:
// `woocommerce/woocommerce.php`, or `hello.php` for a single-file plugin.
export function activePlugins( site: WordPressSite ): string[] {
	const plugins = site.option( 'active_plugins' );
	return plugins && typeof plugins === 'object'
		? Object.values( plugins ).filter( ( file ): file is string => typeof file === 'string' )
		: [];
}

/** Site fact: the active plugins. */
export function activePluginsFact( site: WordPressSite ): string | undefined {
	if ( site.option( 'active_plugins' ) === undefined ) {
		return undefined;
	}
	const plugins = activePlugins( site );
	return `Active plugins: ${ plugins.length ? plugins.join( ', ' ) : 'none' }.`;
}

/**
 * Site fact: WooCommerce's Coming soon mode, read from the options WooCommerce
 * reads (src/Internal/ComingSoon/ComingSoonHelper.php). Logged-out visitors,
 * and so screenshots and fetches of the site, get the Coming soon page.
 */
export function comingSoonFact( site: WordPressSite ): string | undefined {
	if (
		site.option( 'woocommerce_coming_soon' ) !== 'yes' ||
		! activePlugins( site ).includes( 'woocommerce/woocommerce.php' )
	) {
		return undefined;
	}
	const pages =
		site.option( 'woocommerce_store_pages_only' ) === 'yes' ? 'its store pages' : 'the site';
	return `WooCommerce's Coming soon mode is on (woocommerce_coming_soon): visitors who are not logged in, including screenshots, get a Coming soon page instead of ${ pages }.`;
}
