import { getFrontendUrl, siteFrontendSchema } from '@studio/common/lib/site-frontend';
import { readSites } from '@studio/common/sites/site-path';

/**
 * The origins of each headless site: its WordPress addresses and its
 * frontend's. A headless site runs on two origins, and the preview pane treats
 * links between them as staying on the site.
 *
 * Navigation guards run synchronously, so they read a cached copy, read from
 * `cli.json` rather than a CLI fork: warmed at boot and refreshed on each CLI
 * site event (`cli-events-subscriber.ts`).
 */

let cachedGroups: string[][] = [];
// Refreshes run one after another, so the last one reads the newest `cli.json`.
let refreshQueue: Promise< void > = Promise.resolve();

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
	refreshQueue = refreshQueue.then( async () => {
		try {
			cachedGroups = getHeadlessSiteOriginGroups( await readSites() );
		} catch {
			// Keep the last known groups.
		}
	} );
	return refreshQueue;
}

// Whether two URLs belong to one site, from the cache.
export function isSameSitePreviewOrigin( a: string, b: string ): boolean {
	return areSameSiteOrigins( cachedGroups, a, b );
}
