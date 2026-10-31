import { getFrontendUrl, siteFrontendSchema } from '@studio/common/lib/site-frontend';
import { readSites } from '@studio/common/sites/site-path';

/**
 * The origins of each headless site: its WordPress addresses and its
 * frontend's. A headless site runs on two origins, and the preview pane treats
 * links between them as staying on the site.
 *
 * Navigation guards run synchronously, so they read a cached copy that
 * refreshes in the background, from `cli.json` rather than a CLI fork.
 */

const CACHE_TTL_MS = 5_000;

let cachedGroups: string[][] = [];
let cachedAt = 0;
let refreshing: Promise< void > | null = null;

function toOrigin( url: string ): string | null {
	try {
		return new URL( url ).origin;
	} catch {
		return null;
	}
}

export function getHeadlessSiteOriginGroups(
	sites: Array< Record< string, unknown > >
): string[][] {
	return sites.flatMap( ( site ) => {
		const frontend = siteFrontendSchema.safeParse( site.frontend );
		if ( ! frontend.success ) {
			return [];
		}
		const candidates = [ getFrontendUrl( frontend.data ) ];
		if ( typeof site.port === 'number' ) {
			candidates.push( `http://localhost:${ site.port }` );
		}
		if ( typeof site.url === 'string' ) {
			candidates.push( site.url );
		}
		if ( typeof site.customDomain === 'string' && site.customDomain ) {
			candidates.push( `http://${ site.customDomain }`, `https://${ site.customDomain }` );
		}
		const origins = [
			...new Set( candidates.map( toOrigin ).filter( ( origin ) => origin !== null ) ),
		];
		return origins.length > 1 ? [ origins ] : [];
	} );
}

export function areSameSiteOrigins( groups: string[][], a: string, b: string ): boolean {
	const originA = toOrigin( a );
	const originB = toOrigin( b );
	if ( ! originA || ! originB ) {
		return false;
	}
	return (
		originA === originB ||
		groups.some( ( group ) => group.includes( originA ) && group.includes( originB ) )
	);
}

export function refreshHeadlessSiteOrigins(): Promise< void > {
	refreshing ??= readSites()
		.then( ( sites ) => {
			cachedGroups = getHeadlessSiteOriginGroups( sites );
			cachedAt = Date.now();
		} )
		.catch( () => undefined )
		.finally( () => {
			refreshing = null;
		} );
	return refreshing;
}

// Whether two URLs belong to one site, from the cache; a stale cache answers
// and refreshes for the next check.
export function isSameSitePreviewOrigin( a: string, b: string ): boolean {
	if ( Date.now() - cachedAt > CACHE_TTL_MS ) {
		void refreshHeadlessSiteOrigins();
	}
	return areSameSiteOrigins( cachedGroups, a, b );
}
