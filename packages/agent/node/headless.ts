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

// For tools that load a page: a full URL, or a local site with an optional path, as
// take_screenshot takes them. A headless site is loaded on its frontend.
export const SITE_PAGE_URL_PARAMETERS = {
	url: Type.Optional(
		Type.String( {
			description:
				'Absolute URL of the page to load. When set, this is used and `nameOrPath` and `path` are ignored.',
		} )
	),
	nameOrPath: Type.Optional(
		Type.String( {
			description:
				'Local site name or file system path. Used only when `url` is omitted; the site must be running. A headless site resolves to its frontend.',
		} )
	),
	path: Type.Optional(
		Type.String( {
			description:
				'Site-relative path to load with `nameOrPath` (for example "/", "/about"). Defaults to "/". Ignored when `url` is set.',
		} )
	),
};

// The page a tool loads: `url` as given, or else `path` on the site, with one slash between them.
export async function resolveSitePageUrl(
	host: StudioAgentHost,
	args: { url?: string; nameOrPath?: string; path?: string }
): Promise< string > {
	if ( args.url ) {
		return args.url;
	}
	const nameOrPath = args.nameOrPath?.trim();
	if ( ! nameOrPath ) {
		throw new Error( 'Provide either `url` or `nameOrPath`.' );
	}
	const base = getSiteRenderUrl( await host.sites.resolve( nameOrPath ) ).replace( /\/+$/, '' );
	const relative = ( args.path ?? '' ).trim().replace( /^\/+/, '' );
	return `${ base }/${ relative }`;
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
