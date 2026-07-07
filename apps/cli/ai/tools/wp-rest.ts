/**
 * Helpers for talking to a self-hosted WordPress REST API regardless of the
 * site's permalink settings.
 *
 * WordPress exposes its REST API at two different URL shapes:
 *   - Pretty permalinks:            https://site.com/wp-json/wp/v2/posts
 *   - Plain permalinks (fallback):  https://site.com/?rest_route=/wp/v2/posts
 *
 * The pretty `/wp-json/` route only exists when the site uses a non-plain
 * permalink structure, because the route is registered through a rewrite rule.
 * On a plain-permalink site `/wp-json/` returns 404 and only the `?rest_route=`
 * form works. We discover the correct root once (at connect time) and store it,
 * then build every request URL from that root.
 */

/**
 * Extracts the REST API root URL advertised by a page's `Link` HTTP header.
 * WordPress announces the root with `rel="https://api.w.org/"`; this yields the
 * exact root even for subdirectory installs or custom REST prefixes. Returns
 * `null` when the header is missing or has no matching link.
 */
export function parseRestApiRootFromLinkHeader(
	linkHeader: string | null | undefined
): string | null {
	if ( ! linkHeader ) {
		return null;
	}
	// Multiple links are comma-separated; split before each "<url>" entry.
	for ( const entry of linkHeader.split( /,\s*(?=<)/ ) ) {
		const urlMatch = entry.match( /<([^>]+)>/ );
		if ( urlMatch && /rel=["']?https:\/\/api\.w\.org\/["']?/.test( entry ) ) {
			return urlMatch[ 1 ];
		}
	}
	return null;
}

/**
 * Discovers the REST API root for a WordPress site, handling both pretty and
 * plain permalink setups. Returns an absolute URL such as
 * `https://site.com/wp-json/` or `https://site.com/?rest_route=/`.
 *
 * Resolution order:
 *   1. The `api.w.org` Link header on the homepage (exact root; also covers
 *      subdirectory installs and custom REST prefixes).
 *   2. A direct probe of the two well-known roots, so plain-permalink sites are
 *      still found when the header is stripped by a cache or security plugin.
 *   3. Fall back to the pretty `/wp-json/` root so callers surface a clear error.
 */
export async function discoverRestApiRoot(
	siteUrl: string,
	fetchImplementation: typeof fetch = fetch
): Promise< string > {
	const baseUrl = siteUrl.replace( /\/+$/, '' );

	try {
		const homepage = await fetchImplementation( `${ baseUrl }/`, { method: 'HEAD' } );
		const linked = parseRestApiRootFromLinkHeader( homepage.headers.get( 'link' ) );
		if ( linked ) {
			return linked;
		}
	} catch {
		// Ignore and fall back to probing the well-known roots below.
	}

	const prettyRoot = `${ baseUrl }/wp-json/`;
	const fallbackRoot = `${ baseUrl }/?rest_route=/`;
	for ( const candidate of [ prettyRoot, fallbackRoot ] ) {
		try {
			const response = await fetchImplementation( candidate );
			if ( response.ok ) {
				return candidate;
			}
		} catch {
			// Try the next candidate.
		}
	}

	return prettyRoot;
}

/**
 * Builds a full REST API request URL from a discovered root, a namespace
 * (`wp/v2`, `wc/v3`), and a path relative to that namespace (`/posts`). Works
 * with both the pretty `/wp-json/` root and the `?rest_route=` fallback.
 */
export function buildRestApiUrl(
	restRoot: string,
	apiNamespace: string,
	relativePath: string
): URL {
	const namespace = apiNamespace.replace( /^\/+|\/+$/g, '' );
	const path = relativePath.startsWith( '/' ) ? relativePath : `/${ relativePath }`;
	const route = `${ namespace }${ path }`;

	const url = new URL( restRoot );
	const restRouteParam = url.searchParams.get( 'rest_route' );
	if ( restRouteParam !== null ) {
		// Plain-permalink fallback: the route lives in the `rest_route` query
		// param. WordPress URL-decodes it, so encoded slashes are fine.
		const base = restRouteParam.replace( /\/+$/, '' );
		url.searchParams.set( 'rest_route', `${ base }/${ route }` );
	} else {
		// Pretty permalinks: append the route to the root path.
		const base = url.pathname.replace( /\/+$/, '' );
		url.pathname = `${ base }/${ route }`;
	}
	return url;
}
