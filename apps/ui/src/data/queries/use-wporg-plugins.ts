import { useQuery } from '@tanstack/react-query';

const WPORG_PLUGINS_API_URL = 'https://api.wordpress.org/plugins/info/1.2/';

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

interface WporgPluginsResponse {
	plugins?: Array< {
		slug?: string;
		name?: string;
		version?: string;
		author?: string;
		short_description?: string;
		active_installs?: number;
		tested?: string;
		icons?: Record< string, string >;
	} >;
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

async function fetchWporgPluginsByAuthor( author: string ): Promise< WporgPlugin[] > {
	const url = new URL( WPORG_PLUGINS_API_URL );
	url.searchParams.set( 'action', 'query_plugins' );
	url.searchParams.set( 'request[author]', author );
	url.searchParams.set( 'request[per_page]', '24' );
	url.searchParams.set( 'request[fields][icons]', '1' );
	url.searchParams.set( 'request[fields][active_installs]', '1' );

	const response = await fetch( url.toString() );
	if ( ! response.ok ) {
		throw new Error( `WordPress.org plugins request failed: ${ response.status }` );
	}
	const data = ( await response.json() ) as WporgPluginsResponse;
	const plugins = ( data.plugins ?? [] )
		.filter( ( plugin ) => plugin.slug && plugin.name )
		.map( ( plugin ) => ( {
			slug: plugin.slug!,
			name: stripHtml( plugin.name! ),
			version: plugin.version ?? '',
			author: plugin.author ? stripHtml( plugin.author ) : '',
			shortDescription: plugin.short_description ? stripHtml( plugin.short_description ) : '',
			activeInstalls: plugin.active_installs ?? 0,
			tested: plugin.tested ?? '',
			icon: pickIcon( plugin.icons ),
		} ) );
	// Most-installed first — the plugins someone actually works on tend to
	// be their most-used ones.
	return plugins.sort( ( a, b ) => b.activeInstalls - a.activeInstalls );
}

/**
 * Plugins attributed to a WordPress.org username, from the public plugin
 * directory API. Backs the "Connect to WordPress.org" flow's plugin list
 * once an account is connected. (Committer-only plugins that aren't
 * publicly attributed require logged-in scraping — a later iteration.)
 */
export function useWporgAuthorPlugins( author: string | undefined ) {
	return useQuery( {
		enabled: !! author,
		queryKey: [ 'wporg-author-plugins', author ],
		queryFn: () => fetchWporgPluginsByAuthor( author! ),
		staleTime: 60 * 60 * 1000,
	} );
}
