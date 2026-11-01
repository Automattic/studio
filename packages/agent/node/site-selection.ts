import { existsSync } from 'node:fs';
import path from 'node:path';
import type { HeadlessSiteDetails } from './headless';
import type { SiteInfo } from './types';

// The active site, as the system prompt states it: which site the session is
// attached to, rebuilt every turn from Studio's site data.
export function formatActiveSite( site: SiteInfo, headless?: HeadlessSiteDetails ): string {
	if ( site.remote && site.url ) {
		return `"${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)`;
	}
	const designPath = path.join( site.path, 'DESIGN.md' );
	const design = existsSync( designPath ) ? `, design system: ${ designPath }` : '';
	return `"${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }${ headless ? `\n\n${ formatHeadless( headless ) }` : '' }`;
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
