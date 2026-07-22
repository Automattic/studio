import type { SiteDetails, SyncSite } from '@/data/core';

export type ConnectSiteGroup =
	| 'available'
	| 'connected'
	| 'needs-transfer'
	| 'needs-upgrade'
	| 'unavailable';

export interface PresentedRemoteSite {
	site: SyncSite;
	group: ConnectSiteGroup;
	connectedLocalSiteNames: string[];
}

export function presentRemoteSites(
	remoteSites: SyncSite[],
	connections: SyncSite[],
	localSites: SiteDetails[]
): PresentedRemoteSite[] {
	const localNames = new Map( localSites.map( ( site ) => [ site.id, site.name ] ) );
	const connectedNames = new Map< number, Set< string > >();

	for ( const connection of connections ) {
		const names = connectedNames.get( connection.id ) ?? new Set< string >();
		names.add( localNames.get( connection.localSiteId ) ?? 'another local Studio site' );
		connectedNames.set( connection.id, names );
	}

	return remoteSites.map( ( site ) => {
		const names = [ ...( connectedNames.get( site.id ) ?? [] ) ];
		let group: ConnectSiteGroup = 'unavailable';
		if ( names.length > 0 || site.syncSupport === 'already-connected' ) {
			group = 'connected';
		} else if ( site.syncSupport === 'syncable' ) {
			group = 'available';
		} else if ( site.syncSupport === 'needs-transfer' ) {
			group = 'needs-transfer';
		} else if ( site.syncSupport === 'needs-upgrade' ) {
			group = 'needs-upgrade';
		}
		return { site, group, connectedLocalSiteNames: names };
	} );
}

export function searchRemoteSites(
	sites: PresentedRemoteSite[],
	query: string
): PresentedRemoteSite[] {
	const needle = query.trim().toLowerCase();
	if ( ! needle ) return sites;
	return sites.filter( ( { site } ) =>
		[ site.name, site.url, site.isPressable ? 'Pressable' : 'WordPress.com', site.environmentType ]
			.filter( Boolean )
			.some( ( value ) => value?.toLowerCase().includes( needle ) )
	);
}
