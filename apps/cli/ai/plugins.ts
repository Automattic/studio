import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import type { WordPressSite } from 'cli/ai/site-database';

// The plugins WordPress loads (the active_plugins option), by plugin file:
// `woocommerce/woocommerce.php`, or `hello.php` for a single-file plugin.
function activePlugins( site: WordPressSite ): string[] {
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

/**
 * Site fact: Jetpack's active modules and whether it is connected, read from
 * the options Jetpack reads: `jetpack_active_modules` (Modules::get_active())
 * and the site id in `jetpack_options` (Connection Manager::is_connected()).
 * A feature's blocks load only while its module is active; the rest load
 * when the `blocks` module is (Jetpack_Gutenberg::should_load()). Until it
 * connects, it activates only the modules whose header says they need no
 * connection.
 */
export function jetpackFact( site: WordPressSite ): string | undefined {
	if ( ! activePlugins( site ).includes( 'jetpack/jetpack.php' ) ) {
		return undefined;
	}
	const stored = site.option( 'jetpack_active_modules' );
	const modules =
		stored && typeof stored === 'object'
			? Object.values( stored ).filter( ( module ): module is string => typeof module === 'string' )
			: [];
	const options = site.option( 'jetpack_options' ) as Record< string, unknown > | undefined;
	const connection = options?.id
		? `registered with WordPress.com as site ${ options.id }`
		: 'not connected to WordPress.com';
	const needConnection = options?.id ? [] : modulesNeedingConnection( site.root );
	return `Jetpack modules active (jetpack_active_modules): ${
		modules.length ? modules.join( ', ' ) : 'none'
	}. Jetpack is ${ connection } (jetpack_options id).${
		needConnection.length
			? ` Until it is, Jetpack activates none of the modules whose header in jetpack/modules says they require a connection (Modules::activate()): ${ needConnection.join(
					', '
			  ) }.`
			: ''
	}`;
}

// The Jetpack modules whose header requires a connection, as Modules::get()
// reads it: each but those whose "Requires Connection" header is No.
function modulesNeedingConnection( root: string ): string[] {
	const dir = path.join( root, 'wp-content/plugins/jetpack/modules' );
	let files: string[];
	try {
		files = readdirSync( dir ).filter( ( file ) => file.endsWith( '.php' ) );
	} catch {
		return [];
	}
	return (
		files
			.filter( ( file ) => {
				const head = readFileSync( path.join( dir, file ), 'utf8' );
				return (
					/Module Name:/.test( head ) &&
					/Requires Connection:[ \t]*(\S*)/.exec( head )?.[ 1 ] !== 'No'
				);
			} )
			.map( ( file ) => file.slice( 0, -4 ) )
			// In one order wherever the folder lists its files, so the fact reads the same.
			.sort()
	);
}

// The pages WooCommerce's store runs on, by the option that names each (wc_get_page_id()).
const WOOCOMMERCE_PAGES = [
	[ 'Shop', 'woocommerce_shop_page_id' ],
	[ 'Cart', 'woocommerce_cart_page_id' ],
	[ 'Checkout', 'woocommerce_checkout_page_id' ],
	[ 'My account', 'woocommerce_myaccount_page_id' ],
] as const;

/**
 * Site fact: WooCommerce's store pages, by the options wc_get_page_id() reads,
 * and how many products are published. WooCommerce's product queries
 * (wc_get_products()) find a product by its `product_type` term, which
 * WooCommerce sets when it saves the product (update_version_and_type()), so
 * a product saved as a plain post is published but not in the store.
 */
export function wooCommerceFact( site: WordPressSite ): string | undefined {
	if ( ! activePlugins( site ).includes( 'woocommerce/woocommerce.php' ) ) {
		return undefined;
	}
	const pages = WOOCOMMERCE_PAGES.map( ( [ name, option ] ) => {
		const id = Number( site.option( option ) );
		const [ page ] = id
			? site.query< { slug: string; status: string } >(
					`SELECT post_name AS slug, post_status AS status FROM ${ site.prefix }posts WHERE ID = ?`,
					id
			  )
			: [];
		return page
			? `${ name } page ${ id } (/${ page.slug }/, ${ page.status })`
			: `no ${ name } page (${ option })`;
	} );
	const [ products ] = site.query< { count: number; untyped: number } >(
		`SELECT COUNT(*) AS count, SUM( NOT EXISTS (
			SELECT 1 FROM ${ site.prefix }term_relationships r
			JOIN ${ site.prefix }term_taxonomy t ON t.term_taxonomy_id = r.term_taxonomy_id
			WHERE r.object_id = p.ID AND t.taxonomy = 'product_type'
		) ) AS untyped FROM ${ site.prefix }posts p WHERE p.post_type = 'product' AND p.post_status = 'publish'`
	);
	const count = products?.count ?? 0;
	const untyped = products?.untyped ?? 0;
	const missing = untyped
		? `, ${ untyped } of them with no product type (product_type), which WooCommerce's product queries need (wc_get_products()) and WooCommerce sets when it saves a product`
		: '';
	return `WooCommerce store: ${ pages.join( ', ' ) }; ${ count } published product${
		count === 1 ? '' : 's'
	}${ missing }.`;
}
