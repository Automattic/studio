import { __ } from '@wordpress/i18n';
import type { SyncSite } from '@/data/core';

export type ConnectSiteGroup = 'available' | 'needs-transfer' | 'needs-upgrade' | 'unavailable';

interface PresentedRemoteSite {
	site: SyncSite;
	group: ConnectSiteGroup;
}

// Connecting a site pulls it into the new local site, so what counts is whether it can be pulled.
export function presentRemoteSites( remoteSites: SyncSite[] ): PresentedRemoteSite[] {
	return remoteSites.flatMap( ( site ) => {
		const support = site.pullSupport ?? site.syncSupport;
		if ( support === 'already-connected' ) return [];
		let group: ConnectSiteGroup = 'unavailable';
		if ( support === 'syncable' ) {
			group = 'available';
		} else if ( support === 'needs-transfer' ) {
			group = 'needs-transfer';
		} else if ( support === 'needs-upgrade' ) {
			group = 'needs-upgrade';
		}
		return [ { site, group } ];
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

export function getRemoteSiteName( site: SyncSite ): string {
	if ( site.name.trim() ) return site.name.trim();
	try {
		return new URL( site.url ).hostname;
	} catch {
		return __( 'WordPress site' );
	}
}
