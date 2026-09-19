const SKIP_PATHS = /^\/(?:cart|account|login|signup|checkout|search|api|admin|favicon)(?:\/|$)/i;
const ASSET_PATH =
	/\.(?:css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|pdf|zip|xml|json)$/i;

export interface LinkedRouteDiscoveryOptions {
	siteUrl: string;
	initialUrls: string[];
	loadLinks: ( url: string ) => Promise< string[] >;
	maxPages?: number;
	maxDepth?: number;
	maxUrls?: number;
}

export interface LinkedRouteDiscoveryResult {
	urls: string[];
	failures: Array< { url: string; reason: string } >;
}

/**
 * The `siteUrl` origin discoverLinkedRoutes filters every URL against has to be the site's real,
 * resolved host - not necessarily what the operator typed. A site that redirects the bare host to
 * www (or the reverse) returns every sitemap URL and every link scraped off the (redirected)
 * rendered page on that resolved host; passing the raw input as `siteUrl` then rejects all of them
 * as "off-origin" and the crawl returns only the one seed URL (blacksheepbikes.com: 28 real sitemap
 * pages fell to 1). `resolvedUrls` - a sitemap's own URLs, already fetched from the real site - carry
 * the correct host, so take the origin from the first one when there is one; keep the operator's own
 * path either way, since that part of the input is still what scopes a path-hosted site
 * (wix.com/user/site-name).
 */
export function resolveCanonicalSiteUrl( inputUrl: string, resolvedUrls: string[] ): string {
	if ( resolvedUrls.length === 0 ) return inputUrl;
	return new URL( resolvedUrls[ 0 ] ).origin + ( new URL( inputUrl ).pathname || '/' );
}

function contentUrl(
	value: string,
	baseUrl: string,
	origin: string,
	rootPath: string
): string | null {
	try {
		const url = new URL( value, baseUrl );
		if ( url.origin !== origin || ! [ 'http:', 'https:' ].includes( url.protocol ) ) return null;
		if (
			rootPath !== '/' &&
			url.pathname !== rootPath &&
			! url.pathname.startsWith( `${ rootPath }/` )
		) {
			return null;
		}
		if ( SKIP_PATHS.test( url.pathname ) || ASSET_PATH.test( url.pathname ) ) return null;
		url.hash = '';
		url.pathname = url.pathname.replace( /\/$/, '' ) || '/';
		return url.href;
	} catch {
		return null;
	}
}

export async function discoverLinkedRoutes(
	options: LinkedRouteDiscoveryOptions
): Promise< LinkedRouteDiscoveryResult > {
	const maxPages = options.maxPages ?? 100;
	const maxDepth = options.maxDepth ?? 3;
	const maxUrls = options.maxUrls ?? 50_000;
	const sourceUrl = new URL( options.siteUrl );
	const origin = sourceUrl.origin;
	const rootPath = sourceUrl.pathname.replace( /\/$/, '' ) || '/';
	const siteUrl = contentUrl( options.siteUrl, options.siteUrl, origin, rootPath );
	if ( ! siteUrl ) return { urls: [], failures: [] };

	const urls: string[] = [];
	const known = new Set< string >();
	const queue: Array< { url: string; depth: number } > = [];
	const queued = new Set< string >();
	const enqueue = ( url: string, depth: number, prioritize = false ) => {
		if ( queued.has( url ) ) return;
		queued.add( url );
		if ( prioritize ) queue.unshift( { url, depth } );
		else queue.push( { url, depth } );
	};
	const retain = ( value: string, baseUrl: string ): string | null => {
		const url = contentUrl( value, baseUrl, origin, rootPath );
		if ( ! url || known.has( url ) || urls.length >= maxUrls ) return url;
		known.add( url );
		urls.push( url );
		return url;
	};

	retain( siteUrl, siteUrl );
	enqueue( siteUrl, 0 );
	for ( const value of options.initialUrls ) {
		retain( value, siteUrl );
	}

	const failures: Array< { url: string; reason: string } > = [];
	let crawled = 0;
	while ( queue.length > 0 && crawled < maxPages ) {
		const current = queue.shift()!;
		if ( current.depth > maxDepth ) continue;
		crawled++;
		try {
			const discovered: string[] = [];
			for ( const value of await options.loadLinks( current.url ) ) {
				const url = retain( value, current.url );
				if ( url && ! queued.has( url ) && current.depth < maxDepth ) discovered.push( url );
			}
			for ( let index = discovered.length - 1; index >= 0; index-- ) {
				enqueue( discovered[ index ], current.depth + 1, true );
			}
		} catch ( error ) {
			failures.push( {
				url: current.url,
				reason: error instanceof Error ? error.message : String( error ),
			} );
		}
	}

	return { urls, failures };
}
