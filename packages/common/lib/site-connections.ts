import type { ConfigSite, SiteConnection } from './config/schema';
import type { Snapshot } from '../types/snapshot';
import type { SitesProviderId } from '@studio/providers';

type PreviewIdentity = Pick< Snapshot, 'atomicSiteId' | 'userId' >;
type LocalConnections = Pick< ConfigSite, 'connections' >;

export function recordTransfer(
	connection: SiteConnection,
	direction: 'push' | 'pull',
	version: string | null | undefined,
	at = Date.now()
) {
	connection.localVersionId = version;
	connection[ direction === 'push' ? 'lastPushTimestamp' : 'lastPullTimestamp' ] = new Date(
		at
	).toISOString();
}

export function findPreviewConnection(
	site: LocalConnections | undefined,
	preview: PreviewIdentity
) {
	return site?.connections?.find(
		( connection ) =>
			connection.provider === 'wpcom' &&
			connection.account === preview.userId?.toString() &&
			connection.site.id === preview.atomicSiteId
	);
}

export function destinationConnection(
	local: LocalConnections,
	provider: SitesProviderId,
	account: string | undefined,
	id: number | string,
	preview = false
): SiteConnection {
	const connections = ( local.connections ??= [] );
	const existing = connections.find(
		( connection ) =>
			connection.provider === provider &&
			connection.account === account &&
			connection.site.id === id
	);
	if ( existing ) return existing;
	const connection: SiteConnection = {
		provider,
		account,
		site: { id },
		lastPushTimestamp: null,
		lastPullTimestamp: null,
		...( preview && { preview: true } ),
	};
	connections.push( connection );
	return connection;
}

export function recordPreviewTransfer(
	site: LocalConnections,
	preview: PreviewIdentity,
	direction: 'push' | 'pull',
	version: string | null | undefined,
	at: number
) {
	const connection = destinationConnection(
		site,
		'wpcom',
		preview.userId?.toString(),
		preview.atomicSiteId,
		true
	);
	recordTransfer( connection, direction, version, at );
	return connection;
}

export function lastTransferTime(
	connection: Pick< SiteConnection, 'lastPushTimestamp' | 'lastPullTimestamp' >
) {
	const times = [ connection.lastPushTimestamp, connection.lastPullTimestamp ]
		.flatMap( ( time ) => ( time ? [ Date.parse( time ) ] : [] ) )
		.filter( Number.isFinite );
	return times.length ? Math.max( ...times ) : undefined;
}
