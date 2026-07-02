import { useQuery } from '@tanstack/react-query';

const WPORG_PLUGINS_API_URL = 'https://api.wordpress.org/plugins/info/1.2/';

// The directory API caps a page at 100 results; authors with more span
// several pages.
const WPORG_PLUGINS_PER_PAGE = 100;
// Safety valve so a runaway `info.pages` can't loop forever.
const WPORG_PLUGINS_MAX_PAGES = 20;

export interface WporgPlugin {
	slug: string;
	name: string;
	version: string;
	author: string;
	shortDescription: string;
	activeInstalls: number;
	tested: string;
	icon?: string;
}

interface WporgPluginInfo {
	slug?: string;
	name?: string;
	version?: string;
	author?: string;
	short_description?: string;
	active_installs?: number;
	tested?: string;
	icons?: Record< string, string >;
}

interface WporgPluginsResponse {
	info?: { page?: number; pages?: number; results?: number };
	plugins?: WporgPluginInfo[];
}

// The .org API returns HTML in several fields (entity-encoded names, an
// anchor tag for the author); flatten to plain text for display.
function stripHtml( value: string ): string {
	const doc = new DOMParser().parseFromString( value, 'text/html' );
	return ( doc.body.textContent ?? '' ).trim();
}

function pickIcon( icons: Record< string, string > | undefined ): string | undefined {
	if ( ! icons ) {
		return undefined;
	}
	return icons.svg ?? icons[ '2x' ] ?? icons[ '1x' ] ?? icons.default;
}

async function fetchWporgPluginsPage(
	author: string,
	page: number
): Promise< WporgPluginsResponse > {
	const url = new URL( WPORG_PLUGINS_API_URL );
	url.searchParams.set( 'action', 'query_plugins' );
	url.searchParams.set( 'request[author]', author );
	url.searchParams.set( 'request[per_page]', String( WPORG_PLUGINS_PER_PAGE ) );
	url.searchParams.set( 'request[page]', String( page ) );
	url.searchParams.set( 'request[fields][icons]', '1' );
	url.searchParams.set( 'request[fields][active_installs]', '1' );

	const response = await fetch( url.toString() );
	if ( ! response.ok ) {
		throw new Error( `WordPress.org plugins request failed: ${ response.status }` );
	}
	return ( await response.json() ) as WporgPluginsResponse;
}

function toWporgPlugin( plugin: WporgPluginInfo ): WporgPlugin {
	return {
		slug: plugin.slug!,
		name: stripHtml( plugin.name! ),
		version: plugin.version ?? '',
		author: plugin.author ? stripHtml( plugin.author ) : '',
		shortDescription: plugin.short_description ? stripHtml( plugin.short_description ) : '',
		activeInstalls: plugin.active_installs ?? 0,
		tested: plugin.tested ?? '',
		icon: pickIcon( plugin.icons ),
	};
}

async function fetchWporgPluginsByAuthor( author: string ): Promise< WporgPlugin[] > {
	const first = await fetchWporgPluginsPage( author, 1 );
	const totalPages = Math.min( first.info?.pages ?? 1, WPORG_PLUGINS_MAX_PAGES );
	const rawPlugins = [ ...( first.plugins ?? [] ) ];

	// Pages after the first, fetched in parallel and appended in order.
	if ( totalPages > 1 ) {
		const rest = await Promise.all(
			Array.from( { length: totalPages - 1 }, ( _, index ) =>
				fetchWporgPluginsPage( author, index + 2 )
			)
		);
		for ( const pageData of rest ) {
			rawPlugins.push( ...( pageData.plugins ?? [] ) );
		}
	}

	// Most-installed first — the plugins someone actually works on tend to
	// be their most-used ones.
	return rawPlugins
		.filter( ( plugin ) => plugin.slug && plugin.name )
		.map( toWporgPlugin )
		.sort( ( a, b ) => b.activeInstalls - a.activeInstalls );
}

/**
 * Every plugin attributed to a WordPress.org username, from the public
 * plugin directory API (paginated). Backs the "Connect to WordPress.org"
 * flow's plugin list.
 */
export function useWporgAuthorPlugins( author: string | undefined ) {
	return useQuery( {
		enabled: !! author,
		queryKey: [ 'wporg-author-plugins', author ],
		queryFn: () => fetchWporgPluginsByAuthor( author! ),
		staleTime: 60 * 60 * 1000,
	} );
}
