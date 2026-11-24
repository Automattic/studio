import { getProvider } from '@studio/providers';
import { readConfig, updateConfig } from './config/store';
import { providerConfigFrom } from './provider-config';
import { destinationConnection, recordTransfer } from './site-connections';
import type { Config, ConfigSite, SiteConnection } from './config/schema';
import type { ProviderSites, SitesProviderId } from '@studio/providers';

/**
 * The remote sites each local site syncs with, per provider, kept on the local site's record.
 * Connections are Studio's data, not the provider's. A connection to a provider whose account has
 * an `owner` belongs to the account that made it, so only that account's are listed.
 */

export interface SyncTimes {
	localSiteId: string;
	lastPushTimestamp: string | null;
	lastPullTimestamp: string | null;
	localVersionId?: string | null;
}

export type RemoteSiteConnection< Id extends SitesProviderId > = ProviderSites[ Id ] & SyncTimes;

// The account a provider's connections belong to; null when it needs one and none is connected.
function getAccount( config: Config, provider: SitesProviderId ): string | undefined | null {
	const owner = getProvider( provider )?.account?.owner as
		| ( ( providerConfig: unknown ) => string | undefined )
		| undefined;
	if ( ! owner ) {
		return undefined;
	}
	const providerConfig = providerConfigFrom( config, provider );
	return ( providerConfig && owner( providerConfig ) ) || null;
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
				.filter(
					( connection ) => ! connection.preview && isConnection( connection, provider, account )
				)
				.map(
					( { site: remote, lastPushTimestamp, lastPullTimestamp, localVersionId } ) =>
						( {
							...remote,
							...( localVersionId === undefined ? {} : { localVersionId } ),
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
	update: ( site: ConfigSite, account: string | undefined ) => void
): Promise< void > {
	await updateConfig( ( config ) => {
		const account = getAccount( config, provider );
		const site = config.sites.find( ( candidate ) => candidate.id === localSiteId );
		if ( site && account !== null ) {
			update( site, account );
			if ( ! site.connections?.length ) {
				delete site.connections;
			}
		}
	} );
}

// A bought preview becomes a hosted connection in place, keeping every recorded transfer.
export function setRemoteSiteDetails< Id extends SitesProviderId >(
	connection: SiteConnection,
	provider: Id,
	site: ProviderSites[ Id ]
) {
	const {
		localSiteId: _local,
		localVersionId: _version,
		lastPushTimestamp,
		lastPullTimestamp,
		...remote
	} = withoutUndefined( site );
	if ( provider === 'wpcom' ) remote.syncSupport = 'already-connected';
	delete connection.preview;
	Object.assign( connection.site, remote );
	if ( typeof lastPushTimestamp === 'string' ) connection.lastPushTimestamp = lastPushTimestamp;
	if ( typeof lastPullTimestamp === 'string' ) connection.lastPullTimestamp = lastPullTimestamp;
}

export async function rememberRemoteSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	site: ProviderSites[ Id ],
	{ synced, localVersionId }: { synced?: 'push' | 'pull'; localVersionId?: string | null } = {}
): Promise< void > {
	await updateConnections( provider, localSiteId, ( local, account ) => {
		const connection = destinationConnection( local, provider, account, site.id );
		setRemoteSiteDetails( connection, provider, site );
		if ( synced ) recordTransfer( connection, synced, localVersionId ?? null );
	} );
}

export async function forgetRemoteSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	siteId: ProviderSites[ Id ][ 'id' ]
): Promise< void > {
	await updateConnections( provider, localSiteId, ( local, account ) => {
		local.connections = local.connections?.filter(
			( connection ) =>
				! isConnection( connection, provider, account ) || connection.site.id !== siteId
		);
	} );
}

// Another account's connections stay, for when it is connected again.
function replacePublishingDestination(
	config: Config,
	local: ConfigSite,
	destination: SiteConnection
) {
	local.connections = ( local.connections ?? [] ).filter(
		( connection ) =>
			connection === destination ||
			connection.preview ||
			( connection.account !== undefined &&
				connection.account !== getAccount( config, connection.provider as SitesProviderId ) )
	);
}

async function savePublishingSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	site: ProviderSites[ Id ],
	localVersionId?: string | null
): Promise< void > {
	await updateConfig( ( config ) => {
		const account = getAccount( config, provider );
		if ( account === null ) {
			throw new Error( `Sign in to ${ getProvider( provider ).label } to connect this site.` );
		}
		const local = config.sites.find( ( candidate ) => candidate.id === localSiteId );
		if ( ! local ) return;
		const connection = destinationConnection( local, provider, account, site.id );
		const published = localVersionId !== undefined;
		const replacing = ! published || connection.site.launchAfterPush;
		setRemoteSiteDetails( connection, provider, site );
		if ( published ) {
			recordTransfer( connection, 'push', localVersionId );
		}
		if ( replacing ) replacePublishingDestination( config, local, connection );
	} );
}

export function recordRemoteSitePublish< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	site: ProviderSites[ Id ],
	localVersionId: string | null
): Promise< void > {
	return savePublishingSite( provider, localSiteId, site, localVersionId );
}

export function connectPublishingSite< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string,
	site: ProviderSites[ Id ]
): Promise< void > {
	return 'launchAfterPush' in site && site.launchAfterPush
		? rememberRemoteSite( provider, localSiteId, site )
		: savePublishingSite( provider, localSiteId, site );
}
