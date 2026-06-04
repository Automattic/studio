import type { SiteDetails } from '@/data/core';

// Mirrors apps/studio/src/lib/get-site-url.ts. Computes the site URL from
// the site object so callers don't depend on `site.url` (which the main
// process strips when the server is stopped).
export function getSiteUrl( site: SiteDetails ): string {
	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}
	// Hosted sites (e.g. Studio Web) carry an absolute remote URL and no local
	// port. Prefer it; on desktop running sites this is the same localhost URL
	// the fallback would build, so behavior there is unchanged.
	if ( site.url ) {
		return site.url;
	}
	return `http://localhost:${ site.port }`;
}

export function getSiteDisplayUrl( site: SiteDetails ): string {
	return getSiteUrl( site )
		.replace( /^https?:\/\//, '' )
		.replace( /\/$/, '' );
}
