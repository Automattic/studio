import type { StudioAgentHost } from './host';
import type { SiteInfo } from './types';

// The active site, as the system prompt states it: which site the session is
// attached to, rebuilt every turn from Studio's site data.
export function formatActiveSite(
	site: SiteInfo,
	designPath?: string,
	emailPath?: string
): string {
	if ( site.remote && site.url ) {
		return `"${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)`;
	}
	const design = designPath ? `, design system: ${ designPath }` : '';
	const email = emailPath ? `, email it sends: ${ emailPath } (one .eml file per message)` : '';
	return `"${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }${ email }`;
}

// The active local site's DESIGN.md, when it has one.
export async function findActiveSiteDesign(
	{ files, path }: StudioAgentHost,
	site: SiteInfo | null | undefined
): Promise< string | undefined > {
	if ( ! site || site.remote ) {
		return undefined;
	}
	const designPath = path.join( site.path, 'DESIGN.md' );
	return ( await files.exists( designPath ) ) ? designPath : undefined;
}
