import type { SyncSite } from '@/data/core';

export type ConnectSiteGroup = 'available' | 'needs-transfer' | 'needs-upgrade' | 'unavailable';

export interface PresentedRemoteSite {
	site: SyncSite;
	group: ConnectSiteGroup;
}

export function presentRemoteSites( remoteSites: SyncSite[] ): PresentedRemoteSite[] {
	return remoteSites.map( ( site ) => {
		let group: ConnectSiteGroup = 'unavailable';
		if ( site.syncSupport === 'syncable' || site.syncSupport === 'already-connected' ) {
			group = 'available';
		} else if ( site.syncSupport === 'needs-transfer' ) {
			group = 'needs-transfer';
		} else if ( site.syncSupport === 'needs-upgrade' ) {
			group = 'needs-upgrade';
		}
		return { site, group };
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
