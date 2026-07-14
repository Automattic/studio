import type { SiteDetails } from '../types';

// Manual sidebar site order (ordered site ids). The desktop persists this in
// appdata via IPC; the browser connectors have no such store, so it lives in
// localStorage instead.
const SITE_ORDER_STORAGE_KEY = 'studio-ui-site-list-order-v1';

function readStoredSiteOrder(): string[] {
	try {
		const parsed = JSON.parse( window.localStorage.getItem( SITE_ORDER_STORAGE_KEY ) ?? '[]' );
		return Array.isArray( parsed )
			? parsed.filter( ( id ): id is string => typeof id === 'string' )
			: [];
	} catch {
		return [];
	}
}

export function applyStoredSiteOrder( sites: SiteDetails[] ): SiteDetails[] {
	const order = readStoredSiteOrder();
	return sites.map( ( site ) => {
		const index = order.indexOf( site.id );
		return index === -1 ? site : { ...site, sortOrder: ( index + 1 ) * 1000 };
	} );
}

export function storeSiteOrder( updates: { siteId: string; sortOrder: number }[] ): void {
	const orderedIds = [ ...updates ]
		.sort( ( a, b ) => a.sortOrder - b.sortOrder )
		.map( ( update ) => update.siteId );
	try {
		window.localStorage.setItem( SITE_ORDER_STORAGE_KEY, JSON.stringify( orderedIds ) );
	} catch {
		// Ignore storage failures; the order still applies for this session.
	}
}
