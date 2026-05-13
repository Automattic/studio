import { useEffect, useState } from 'react';

/**
 * Cache favicon URLs by site ID so we do not re-fetch on every render.
 * Stores `null` when a site has been checked but has no valid favicon.
 */
const faviconCache = new Map< string, string | null >();

/**
 * Returns a displayable favicon src string for a given site.
 *
 * Priority order:
 *   1. `siteIcon` - a data URL already computed by the main process from the
 *      WordPress site icon set under Appearance > Customize > Site Identity.
 *   2. `/favicon.ico` fetched from the running local server, validated to be
 *      an actual image content-type (not a WordPress HTML redirect).
 *
 * Returns `null` when no favicon is available so callers render a placeholder.
 */
export function useSiteFavicon( siteId: string, site: SiteDetails ): string | null {
	const [ faviconUrl, setFaviconUrl ] = useState< string | null >(
		() => faviconCache.get( siteId ) ?? null
	);

	useEffect( () => {
		// If the main process already resolved a site icon data URL, nothing to do.
		if ( site.siteIcon ) {
			return;
		}

		if ( ! site.running || faviconCache.has( siteId ) ) {
			return;
		}

		const url = `${ ( site as StartedSiteDetails ).url }/favicon.ico`;
		let cancelled = false;

		fetch( url, { method: 'HEAD' } )
			.then( ( res ) => {
				if ( cancelled ) return;

				const contentType = res.headers.get( 'content-type' ) ?? '';
				// WordPress returns text/html when no favicon is configured.
				// Only treat the response as a valid favicon if it is an image.
				const isImage = res.ok && contentType.startsWith( 'image/' );

				const result = isImage ? url : null;
				faviconCache.set( siteId, result );
				setFaviconUrl( result );
			} )
			.catch( () => {
				if ( cancelled ) return;
				faviconCache.set( siteId, null );
				setFaviconUrl( null );
			} );

		return () => {
			cancelled = true;
		};
	}, [ siteId, site.siteIcon, site.running ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// Clear cached value when the site stops so we re-check on next start.
	useEffect( () => {
		if ( ! site.running ) {
			faviconCache.delete( siteId );
			setFaviconUrl( null );
		}
	}, [ siteId, site.running ] );

	// Prefer the data URL already provided by the main process.
	return site.siteIcon ?? faviconUrl;
}
