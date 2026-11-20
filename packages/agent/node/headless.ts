import { getFrontendUrl, type SiteFrontend } from '@studio/common/lib/site-frontend';
import { Type } from 'typebox';
import type { HostSite, StudioAgentHost } from './host';
import type { SiteInfo } from './types';

// What the agent is told about a headless site. Never its secrets: those stay
// in the frontend's `.env.local`.
export interface HeadlessSiteDetails {
	frontendUrl: string;
	frontendPath: string;
	framework: SiteFrontend[ 'framework' ];
	kind: SiteFrontend[ 'kind' ];
	api: NonNullable< SiteFrontend[ 'api' ] >;
	wordpressUrl: string;
	restBase: string;
	graphqlUrl?: string;
}

export function getHeadlessDetails(
	site: Pick< HostSite, 'url' | 'frontend' >
): HeadlessSiteDetails | undefined {
	if ( ! site.frontend ) {
		return undefined;
	}
	const wordpressUrl = site.url.replace( /\/$/, '' );
	const api = site.frontend.api ?? 'rest';
	return {
		frontendUrl: getFrontendUrl( site.frontend ),
		frontendPath: site.frontend.path,
		framework: site.frontend.framework,
		kind: site.frontend.kind,
		api,
		wordpressUrl,
		restBase: `${ wordpressUrl }/wp-json/wp/v2`,
		...( api === 'graphql' ? { graphqlUrl: `${ wordpressUrl }/graphql` } : {} ),
	};
}

// Where visitors see the site: the frontend for a headless site.
export function getSiteRenderUrl( site: Pick< HostSite, 'url' | 'frontend' > ): string {
	return site.frontend ? getFrontendUrl( site.frontend ) : site.url;
}

// For tools that load a page: a full URL, or a path on a site, which for a
// headless site is a path on its frontend.
export const SITE_PAGE_URL_PARAMETERS = {
	url: Type.Optional(
		Type.String( {
			description:
				'The page to load: a full URL, or with `nameOrPath` a path such as "/about". Defaults to the home page of the `nameOrPath` site.',
		} )
	),
	nameOrPath: Type.Optional(
		Type.String( {
			description:
				'A site name or path. Resolves `url` against the site: its frontend for a headless site, WordPress otherwise.',
		} )
	),
};

// Resolves `url` against the site when it is a path; a full URL is used as is.
export async function resolveSitePageUrl(
	host: StudioAgentHost,
	url: string | undefined,
	nameOrPath: string | undefined
): Promise< string > {
	if ( url && /^[a-z][a-z0-9+.-]*:\/\//i.test( url ) ) {
		return url;
	}
	if ( ! nameOrPath ) {
		throw new Error( "Pass a full `url`, or `nameOrPath` to use the site's own URL." );
	}
	const base = getSiteRenderUrl( await host.sites.resolve( nameOrPath ) ).replace( /\/$/, '' );
	const pagePath = url ?? '/';
	return `${ base }${ pagePath.startsWith( '/' ) ? pagePath : `/${ pagePath }` }`;
}

export async function resolveHeadlessSite(
	host: StudioAgentHost,
	nameOrPath: string
): Promise< HostSite & { frontend: SiteFrontend } > {
	const site = await host.sites.resolve( nameOrPath );
	if ( ! site.frontend ) {
		throw new Error(
			`"${ site.name }" is not a headless site: it has no frontend project, so WordPress renders it.`
		);
	}
	return site as HostSite & { frontend: SiteFrontend };
}

// The active site's headless details, read from Studio's site data each turn.
export async function findActiveSiteHeadlessDetails(
	host: StudioAgentHost,
	site: SiteInfo | null | undefined
): Promise< HeadlessSiteDetails | undefined > {
	if ( ! site || site.remote || ! site.path ) {
		return undefined;
	}
	try {
		const hostSite = await host.sites.findByFolder( site.path );
		return hostSite && getHeadlessDetails( hostSite );
	} catch {
		return undefined;
	}
}
