import type { SiteDetails } from '@/data/core';

// Computes the site URL from the site object so callers don't depend on
// `site.url`, which the main process strips when the server is stopped.
export function getSiteUrl( site: SiteDetails ): string {
	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}
	// On running sites this is the same localhost URL the fallback would build.
	if ( site.url ) {
		return site.url;
	}
	return `http://localhost:${ site.port }`;
}

// The origin a headless site's frontend runs on, beside WordPress at
// `getSiteUrl`; undefined for a classic site. Mirrors `getFrontendUrl` in
// `@studio/common/lib/site-frontend`, which depends on Node modules.
export function getSiteFrontendUrl( site: Pick< SiteDetails, 'frontend' > ): string | undefined {
	const { frontend } = site;
	if ( ! frontend ) {
		return undefined;
	}
	return frontend.customDomain
		? `http://${ frontend.customDomain }`
		: `http://localhost:${ frontend.port }`;
}

// Where a site's preview opens: a headless site's frontend app, which the
// preview addresses by absolute URL; otherwise WordPress's home page.
export function getPreviewHomePath( site: Pick< SiteDetails, 'frontend' > ): string {
	const frontendUrl = getSiteFrontendUrl( site );
	return frontendUrl ? `${ frontendUrl }/` : '/';
}
