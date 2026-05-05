import { useEffect, useState } from 'react';

/**
 * Cache favicon URLs by site ID so we do not re-fetch on every render.
 * Stores `null` when a site has been checked but has no favicon available.
 */
const faviconCache = new Map< string, string | null >();

/**
 * Returns a displayable favicon src string for a given site.
 *
 * Priority order:
 *   1. `siteIcon` - a data URL already computed by the main process from the
 *      WordPress site icon set under Appearance > Customize > Site Identity.
 *      This is the highest-quality option and ships with the existing
 *      `SiteDetails` type, so we use it for free when it is present.
 *   2. `/favicon.ico` fetched from the running local server as a fallback for
 *      sites that have not configured a site icon but do have a favicon.
 *
 * Returns `null` when no favicon is available (site stopped, no icon set, etc.)
 * so callers can render a placeholder instead.
 */
export function useSiteFavicon( siteId: string, site: SiteDetails ): string | null {
	// Prefer the data URL already provided by the main process.
	if ( site.siteIcon ) {
		return site.siteIcon;
	}

	// eslint-disable-next-line react-hooks/rules-of-hooks
	const [ faviconUrl, setFaviconUrl ] = useState< string | null >(
		() => faviconCache.get( siteId ) ?? null
	);

	// eslint-disable-next-line react-hooks/rules-of-hooks
	useEffect( () => {
		// Only attempt to fetch if the site is currently running and we do not
		// already have a cached result (including a cached `null` meaning
		// "checked and nothing found").
		if ( ! site.running || faviconCache.has( siteId ) ) {
			return;
		}

		const url = `${ ( site as StartedSiteDetails ).url }/favicon.ico`;

		let cancelled = false;

		fetch( url, { method: 'HEAD' } )
			.then( ( res ) => {
				if ( cancelled ) return;
				const result = res.ok ? url : null;
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
	}, [ siteId, site.running ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// Clear cached value when the site stops so we re-check on next start.
	// eslint-disable-next-line react-hooks/rules-of-hooks
	useEffect( () => {
		if ( ! site.running ) {
			faviconCache.delete( siteId );
			setFaviconUrl( null );
		}
	}, [ siteId, site.running ] );

	return faviconUrl;
}
