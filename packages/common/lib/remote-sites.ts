import {
	addConnectedWpcomSite,
	getAllConnectedWpcomSitesForCurrentUser,
	getConnectedWpcomSitesForLocalSite,
	markConnectedWpcomSiteSynced,
	removeAllConnectedWpcomSitesForLocalSite,
	removeConnectedWpcomSite,
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
	localSiteId: string;
	lastPushTimestamp: string | null;
	lastPullTimestamp: string | null;
}

export type RemoteSiteConnection< Id extends SitesProviderId > = ProviderSites[ Id ] & SyncTimes;

type ConnectionStore< Site extends RemoteSite > = {
	// Every local site's connections when `localSiteId` is undefined.
	list( localSiteId?: string ): Promise< ( Site & SyncTimes )[] >;
	add( localSiteId: string, site: Site, synced?: 'push' | 'pull' ): Promise< void >;
	remove( localSiteId: string, siteId: Site[ 'id' ] ): Promise< void >;
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

// Keeps the connections `keep` accepts, and drops a local site left with none.
function filterConnections(
	config: SharedConfig,
	localSiteId: string,
	keep: ( connection: NonNullable< SharedConfig[ 'remoteSites' ] >[ string ][ number ] ) => boolean
): void {
	const connections = config.remoteSites?.[ localSiteId ]?.filter( keep );
	if ( ! config.remoteSites ) {
		return;
	}
	if ( connections?.length ) {
		config.remoteSites[ localSiteId ] = connections;
	} else {
		delete config.remoteSites[ localSiteId ];
	}
}

function remoteSitesStore< Site extends RemoteSite >( provider: string ): ConnectionStore< Site > {
	return {
		list: async ( localSiteId ) =>
			Object.entries( ( await readSharedConfig() ).remoteSites ?? {} )
				.filter( ( [ id ] ) => localSiteId === undefined || id === localSiteId )
				.flatMap( ( [ id, connections ] ) =>
					connections
						.filter( ( connection ) => connection.provider === provider )
						.map( ( { site, lastPushTimestamp, lastPullTimestamp } ) => ( {
							...( site as Site ),
							localSiteId: id,
							lastPushTimestamp,
							lastPullTimestamp,
						} ) )
				),
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
		remove: ( localSiteId, siteId ) =>
			updateRemoteSites( ( config ) =>
				filterConnections(
					config,
					localSiteId,
					( connection ) => connection.provider !== provider || connection.site.id !== siteId
				)
			),
		removeAll: ( localSiteId ) =>
			updateRemoteSites( ( config ) =>
				filterConnections( config, localSiteId, ( connection ) => connection.provider !== provider )
			),
	};
}

const STORES: { [ Id in SitesProviderId ]: ConnectionStore< ProviderSites[ Id ] > } = {
	wpcom: {
		list: ( localSiteId ) =>
			localSiteId === undefined
				? getAllConnectedWpcomSitesForCurrentUser()
				: getConnectedWpcomSitesForLocalSite( localSiteId ),
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
	spacefast: remoteSitesStore( 'spacefast' ),
};

// The local site's connections, or every local site's when `localSiteId` is undefined.
export function getRemoteSites< Id extends SitesProviderId >(
	provider: Id,
	localSiteId?: string
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

export function forgetRemoteSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	siteId: ProviderSites[ Id ][ 'id' ]
): Promise< void > {
	return ( STORES[ provider ] as ConnectionStore< ProviderSites[ Id ] > ).remove(
		localSiteId,
		siteId
	);
}

// Every provider's connections of a local site, as when it is deleted.
export async function forgetRemoteSites( localSiteId: string ): Promise< void > {
	for ( const store of Object.values( STORES ) ) {
		await store.removeAll( localSiteId );
	}
}
