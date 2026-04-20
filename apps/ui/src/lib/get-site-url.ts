import type { SiteDetails } from '@/data/core';

// Mirrors apps/studio/src/lib/get-site-url.ts. Computes the site URL from
// the site object so callers don't depend on `site.url` (which the main
// process strips when the server is stopped).
export function getSiteUrl( site: SiteDetails ): string {
	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}
	return `http://localhost:${ site.port }`;
}

export function getSiteDisplayUrl( site: SiteDetails ): string {
	return getSiteUrl( site )
		.replace( /^https?:\/\//, '' )
		.replace( /\/$/, '' );
}
