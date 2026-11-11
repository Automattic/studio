import {
	addConnectedWpcomSite,
	getConnectedWpcomSitesForLocalSite,
	markConnectedWpcomSiteSynced,
	removeAllConnectedWpcomSitesForLocalSite,
	removeConnectedWpcomSite,
} from './connected-sites';
import type { ProviderSites, SitesProviderId } from '@studio/providers';

/**
 * The remote sites each local site syncs with, per provider. Connections are
 * Studio's data, not the provider's: each provider's are stored where builds
 * of every version read them, WordPress.com's in `connectedWpcomSites`.
 */

type ConnectionStore< Site extends { id: unknown } > = {
	list( localSiteId: string ): Promise< Site[] >;
	add( localSiteId: string, site: Site, synced?: 'push' | 'pull' ): Promise< void >;
	remove( localSiteId: string, siteId: Site[ 'id' ] ): Promise< void >;
	removeAll( localSiteId: string ): Promise< void >;
};

const STORES: { [ Id in SitesProviderId ]: ConnectionStore< ProviderSites[ Id ] > } = {
	wpcom: {
		list: getConnectedWpcomSitesForLocalSite,
		add: async ( localSiteId, site, synced ) => {
			await addConnectedWpcomSite( localSiteId, { ...site, localSiteId } );
			if ( synced ) {
				await markConnectedWpcomSiteSynced( localSiteId, site.id, synced );
			}
		},
		remove: async ( localSiteId, siteId ) => {
			await removeConnectedWpcomSite( localSiteId, siteId );
		},
		removeAll: removeAllConnectedWpcomSitesForLocalSite,
	},
};

export function getRemoteSites< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string
): Promise< ProviderSites[ Id ][] > {
	return STORES[ provider ].list( localSiteId );
}

// Connects the site, or updates it, and records the sync that just finished.
export function rememberRemoteSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	site: ProviderSites[ Id ],
	synced?: 'push' | 'pull'
): Promise< void > {
	return STORES[ provider ].add( localSiteId, site, synced );
}

export function forgetRemoteSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	siteId: ProviderSites[ Id ][ 'id' ]
): Promise< void > {
	return STORES[ provider ].remove( localSiteId, siteId );
}

// Every provider's connections of a local site, as when it is deleted.
export async function forgetRemoteSites( localSiteId: string ): Promise< void > {
	for ( const store of Object.values( STORES ) ) {
		await store.removeAll( localSiteId );
	}
}
