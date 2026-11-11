import type { HeadlessSiteDetails } from './headless';
import type { StudioAgentHost } from './host';
import type { SiteInfo } from './types';

// The active site, as the system prompt states it: which site the session is
// attached to, rebuilt every turn from Studio's site data.
export function formatActiveSite(
	site: SiteInfo,
	designPath?: string,
	emailPath?: string,
	headless?: HeadlessSiteDetails
): string {
	if ( site.remote && site.url ) {
		return `"${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)`;
	}
	const design = designPath ? `, design system: ${ designPath }` : '';
	const email = emailPath ? `, email it sends: ${ emailPath } (one .eml file per message)` : '';
	return `"${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }${ email }${ headless ? `\n\n${ formatHeadless( headless ) }` : '' }`;
}

const FRAMEWORK_NAMES: Record< string, string > = {
	static: 'static HTML',
	astro: 'Astro',
	next: 'Next.js',
	custom: 'custom',
};

function formatHeadless( headless: HeadlessSiteDetails ): string {
	const framework = headless.framework ? FRAMEWORK_NAMES[ headless.framework ] : 'custom';
	const api =
		headless.api === 'graphql'
			? `GraphQL at ${ headless.graphqlUrl } (REST also at ${ headless.restBase })`
			: `REST at ${ headless.restBase }`;
	return [
		'Headless: yes. WordPress is the backend only; visitors see the frontend.',
		`- Frontend: ${ framework } project at ${ headless.frontendPath }, served at ${ headless.frontendUrl }`,
		`- WordPress: ${ headless.wordpressUrl }, content API: ${ api }`,
	].join( '\n' );
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
