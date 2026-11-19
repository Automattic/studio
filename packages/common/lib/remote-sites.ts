import { authTokenFrom } from './auth-token';
import { readConfig, updateConfig } from './config/store';
import type { Config, ConfigSite, SiteConnection } from './config/schema';
import type { ProviderSites, SitesProviderId } from '@studio/providers';

/**
 * The remote sites each local site syncs with, per provider, kept on the local site's record.
 * Connections are Studio's data, not the provider's. A WordPress.com connection belongs to the
 * account that made it, so only that account's are listed.
 */

export interface SyncTimes {
	localSiteId: string;
	lastPushTimestamp: string | null;
	lastPullTimestamp: string | null;
}

export type RemoteSiteConnection< Id extends SitesProviderId > = ProviderSites[ Id ] & SyncTimes;

// The account a provider's connections belong to; null when it needs one and none is signed in.
function getAccount( config: Config, provider: SitesProviderId ): string | undefined | null {
	if ( provider !== 'wpcom' ) {
		return undefined;
	}
	const userId = authTokenFrom( config )?.id;
	return userId ? String( userId ) : null;
}

function isConnection(
	connection: SiteConnection,
	provider: SitesProviderId,
	account: string | undefined
): boolean {
	return connection.provider === provider && connection.account === account;
}

function withoutUndefined( site: object ): Record< string, unknown > {
	return Object.fromEntries(
		Object.entries( site ).filter( ( [ , value ] ) => value !== undefined )
	);
}

// The local site's connections, or every local site's when `localSiteId` is undefined.
export async function getRemoteSites< Id extends SitesProviderId >(
	provider: Id,
	localSiteId?: string
): Promise< RemoteSiteConnection< Id >[] > {
	const config = await readConfig();
	const account = getAccount( config, provider );
	if ( account === null ) {
		return [];
	}
	return config.sites
		.filter( ( site ) => localSiteId === undefined || site.id === localSiteId )
		.flatMap( ( site ) =>
			( site.connections ?? [] )
				.filter( ( connection ) => isConnection( connection, provider, account ) )
				.map(
					( { site: remote, lastPushTimestamp, lastPullTimestamp } ) =>
						( {
							...remote,
							localSiteId: site.id,
							lastPushTimestamp,
							lastPullTimestamp,
						} ) as RemoteSiteConnection< Id >
				)
		);
}

async function updateConnections(
	provider: SitesProviderId,
	localSiteId: string,
	update: ( connections: SiteConnection[], account: string | undefined, site: ConfigSite ) => void
): Promise< void > {
	await updateConfig( ( config ) => {
		const account = getAccount( config, provider );
		const site = config.sites.find( ( candidate ) => candidate.id === localSiteId );
		if ( site && account !== null ) {
			site.connections ??= [];
			update( site.connections, account, site );
			if ( ! site.connections.length ) {
				delete site.connections;
			}
		}
	} );
}

// Connects the site, or updates it, and records the sync that just finished. Fields the update
// lacks, like the sync times an account's site list doesn't have, are kept.
export async function rememberRemoteSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	site: ProviderSites[ Id ],
	synced?: 'push' | 'pull'
): Promise< void > {
	const {
		localSiteId: _localSiteId,
		lastPushTimestamp,
		lastPullTimestamp,
		...remote
	} = withoutUndefined( site );
	if ( provider === 'wpcom' ) {
		remote.syncSupport = 'already-connected';
	}
	await updateConnections( provider, localSiteId, ( connections, account ) => {
		let connection = connections.find(
			( candidate ) =>
				isConnection( candidate, provider, account ) && candidate.site.id === remote.id
		);
		if ( ! connection ) {
			connection = {
				provider,
				...( account ? { account } : {} ),
				site: {},
				lastPushTimestamp: null,
				lastPullTimestamp: null,
			};
			connections.push( connection );
		}
		connection.site = { ...connection.site, ...remote };
		connection.lastPushTimestamp = ( lastPushTimestamp as string ) ?? connection.lastPushTimestamp;
		connection.lastPullTimestamp = ( lastPullTimestamp as string ) ?? connection.lastPullTimestamp;
		if ( synced ) {
			connection[ synced === 'push' ? 'lastPushTimestamp' : 'lastPullTimestamp' ] =
				new Date().toISOString();
		}
	} );
}

export async function forgetRemoteSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	siteId: ProviderSites[ Id ][ 'id' ]
): Promise< void > {
	await updateConnections( provider, localSiteId, ( connections, account ) => {
		const index = connections.findIndex(
			( connection ) =>
				isConnection( connection, provider, account ) && connection.site.id === siteId
		);
		if ( index !== -1 ) {
			connections.splice( index, 1 );
		}
	} );
}
