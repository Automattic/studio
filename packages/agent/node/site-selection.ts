import type { SiteInfo } from './types';

// The active site, as the system prompt states it: which site the session is
// attached to, rebuilt every turn from Studio's site data.
export function formatActiveSite( site: SiteInfo, designPath?: string ): string {
	if ( site.remote && site.url ) {
		return `"${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)`;
	}
	const design = designPath ? `, design system: ${ designPath }` : '';
	return `"${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }`;
}
