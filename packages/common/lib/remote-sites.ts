import {
	addConnectedWpcomSite,
	getConnectedWpcomSitesForLocalSite,
	markConnectedWpcomSiteSynced,
	removeAllConnectedWpcomSitesForLocalSite,
} from './connected-sites';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
	type SharedConfig,
} from './shared-config';
import type { ProviderSites, RemoteSite, SitesProviderId } from '@studio/providers';

/**
 * The remote sites each local site syncs with, per provider. Connections are
 * Studio's data, not the provider's: WordPress.com's stay in
 * `connectedWpcomSites`, where builds of every version read them, and later
 * providers' are in `remoteSites`.
 */

export interface SyncTimes {
	lastPushTimestamp: string | null;
	lastPullTimestamp: string | null;
}

export type RemoteSiteConnection< Id extends SitesProviderId > = ProviderSites[ Id ] & SyncTimes;

type ConnectionStore< Site extends RemoteSite > = {
	list( localSiteId: string ): Promise< ( Site & SyncTimes )[] >;
	add( localSiteId: string, site: Site, synced?: 'push' | 'pull' ): Promise< void >;
	removeAll( localSiteId: string ): Promise< void >;
};

async function updateRemoteSites( update: ( config: SharedConfig ) => void ): Promise< void > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		update( config );
		await saveSharedConfig( config );
	} finally {
		await unlockSharedConfig();
	}
}

function remoteSitesStore< Site extends RemoteSite >( provider: string ): ConnectionStore< Site > {
	return {
		list: async ( localSiteId ) =>
			( ( await readSharedConfig() ).remoteSites?.[ localSiteId ] ?? [] )
				.filter( ( connection ) => connection.provider === provider )
				.map( ( { site, lastPushTimestamp, lastPullTimestamp } ) => ( {
					...( site as Site ),
					lastPushTimestamp,
					lastPullTimestamp,
				} ) ),
		add: ( localSiteId, site, synced ) =>
			updateRemoteSites( ( config ) => {
				const connections = ( ( config.remoteSites ??= {} )[ localSiteId ] ??= [] );
				let connection = connections.find(
					( candidate ) => candidate.provider === provider && candidate.site.id === site.id
				);
				if ( ! connection ) {
					connection = { provider, site: {}, lastPushTimestamp: null, lastPullTimestamp: null };
					connections.push( connection );
				}
				connection.site = { ...site } as Record< string, unknown >;
				if ( synced ) {
					connection[ synced === 'push' ? 'lastPushTimestamp' : 'lastPullTimestamp' ] =
						new Date().toISOString();
				}
			} ),
		removeAll: ( localSiteId ) =>
			updateRemoteSites( ( config ) => {
				const connections = config.remoteSites?.[ localSiteId ]?.filter(
					( connection ) => connection.provider !== provider
				);
				if ( config.remoteSites && connections?.length ) {
					config.remoteSites[ localSiteId ] = connections;
				} else if ( config.remoteSites ) {
					delete config.remoteSites[ localSiteId ];
				}
			} ),
	};
}

const STORES: { [ Id in SitesProviderId ]: ConnectionStore< ProviderSites[ Id ] > } = {
	wpcom: {
		list: getConnectedWpcomSitesForLocalSite,
		add: async ( localSiteId, site, synced ) => {
			await addConnectedWpcomSite( localSiteId, { ...site, localSiteId } );
			if ( synced ) {
				await markConnectedWpcomSiteSynced( localSiteId, site.id, synced );
			}
		},
		removeAll: removeAllConnectedWpcomSitesForLocalSite,
	},
	spacefast: remoteSitesStore( 'spacefast' ),
};

export function getRemoteSites< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string
): Promise< RemoteSiteConnection< Id >[] > {
	return STORES[ provider ].list( localSiteId ) as Promise< RemoteSiteConnection< Id >[] >;
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

// Every provider's connections of a local site, as when it is deleted.
export async function forgetRemoteSites( localSiteId: string ): Promise< void > {
	for ( const store of Object.values( STORES ) ) {
		await store.removeAll( localSiteId );
	}
}
