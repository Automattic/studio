import { type SyncSite } from '../types/sync';
import {
	getCurrentUserId,
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from './shared-config';
import type { SharedConfig } from './shared-config';

/**
 * Stamp a SyncSite onto a local site entry. Ensures `localSiteId` is
 * consistent and defaults timestamps to null so the schema always validates.
 */
function normalizeStoredSite( site: SyncSite, localSiteId: string ): SyncSite {
	return {
		...site,
		localSiteId,
		lastPullTimestamp: site.lastPullTimestamp ?? null,
		lastPushTimestamp: site.lastPushTimestamp ?? null,
	};
}

async function getCurrentUserKey(): Promise< string | null > {
	const userId = await getCurrentUserId();
	return userId ? String( userId ) : null;
}

function getConnectionsForUser(
	config: Pick< SharedConfig, 'connectedWpcomSites' > | null,
	userKey: string
): SyncSite[] {
	return config?.connectedWpcomSites?.[ userKey ] ?? [];
}

function getMutableConnectionsForUser( config: SharedConfig, userKey: string ): SyncSite[] {
	config.connectedWpcomSites ??= {};
	config.connectedWpcomSites[ userKey ] ??= [];
	return config.connectedWpcomSites[ userKey ];
}

function pruneEmptyConnectionsForUser( config: SharedConfig, userKey: string ): void {
	if ( ! config.connectedWpcomSites ) {
		return;
	}

	if ( config.connectedWpcomSites[ userKey ]?.length === 0 ) {
		delete config.connectedWpcomSites[ userKey ];
	}

	if ( Object.keys( config.connectedWpcomSites ).length === 0 ) {
		delete config.connectedWpcomSites;
	}
}

function upsertConnection( connections: SyncSite[], localSiteId: string, site: SyncSite ): void {
	const incoming = normalizeStoredSite(
		{ ...site, syncSupport: 'already-connected' },
		localSiteId
	);
	const existing = connections.find(
		( connection ) => connection.id === incoming.id && connection.localSiteId === localSiteId
	);

	if ( existing ) {
		Object.assign( existing, incoming );
		return;
	}

	connections.push( incoming );
}

function removeConnection(
	connections: SyncSite[],
	localSiteId: string,
	remoteSiteId: number
): void {
	for ( let index = connections.length - 1; index >= 0; index-- ) {
		const connection = connections[ index ];
		if ( connection.id === remoteSiteId && connection.localSiteId === localSiteId ) {
			connections.splice( index, 1 );
		}
	}
}

function applyConnectionUpdates(
	connections: SyncSite[],
	localSiteId: string,
	updates: SyncSite[]
): void {
	for ( const existing of connections ) {
		if ( existing.localSiteId !== localSiteId ) {
			continue;
		}

		const update = updates.find( ( candidate ) => candidate.id === existing.id );
		if ( update ) {
			Object.assign( existing, normalizeStoredSite( { ...existing, ...update }, localSiteId ) );
		}
	}
}

function stampConnectionSynced(
	connections: SyncSite[],
	localSiteId: string,
	remoteSiteId: number,
	direction: 'push' | 'pull',
	timestamp: string
): void {
	const field = direction === 'push' ? 'lastPushTimestamp' : 'lastPullTimestamp';

	for ( const connection of connections ) {
		if ( connection.id === remoteSiteId && connection.localSiteId === localSiteId ) {
			connection[ field ] = timestamp;
		}
	}
}

/**
 * Returns the WordPress.com sites connected to the given local site for the
 * currently authenticated user. Reads from shared.json without taking a lock —
 * callers must accept eventually-consistent reads.
 */
export async function getConnectedWpcomSitesForLocalSite(
	localSiteId: string
): Promise< SyncSite[] > {
	const userKey = await getCurrentUserKey();
	if ( ! userKey ) {
		return [];
	}
	const config = await readSharedConfig().catch( () => null );
	return getConnectionsForUser( config, userKey ).filter(
		( site ) => site.localSiteId === localSiteId
	);
}

/**
 * Returns every connection stored for the current user, across all local sites.
 */
export async function getAllConnectedWpcomSitesForCurrentUser(): Promise< SyncSite[] > {
	const userKey = await getCurrentUserKey();
	if ( ! userKey ) {
		return [];
	}
	const config = await readSharedConfig().catch( () => null );
	return getConnectionsForUser( config, userKey );
}

/**
 * Adds a WordPress.com site connection to a local site for the current user.
 * Idempotent — if the remote site is already connected to the same local site,
 * the existing entry is updated with the latest fields (including timestamps).
 */
export async function addConnectedWpcomSite(
	localSiteId: string,
	site: SyncSite
): Promise< SyncSite[] > {
	const userKey = await getCurrentUserKey();
	if ( ! userKey ) {
		return [];
	}

	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const connections = getMutableConnectionsForUser( config, userKey );
		upsertConnection( connections, localSiteId, site );
		await saveSharedConfig( config );
		return connections;
	} finally {
		await unlockSharedConfig();
	}
}

/**
 * Removes a WordPress.com site connection from a local site for the current
 * user. Safe to call when the connection doesn't exist.
 */
export async function removeConnectedWpcomSite(
	localSiteId: string,
	remoteSiteId: number
): Promise< SyncSite[] > {
	const userKey = await getCurrentUserKey();
	if ( ! userKey ) {
		return [];
	}

	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const connections = getConnectionsForUser( config, userKey );
		removeConnection( connections, localSiteId, remoteSiteId );
		pruneEmptyConnectionsForUser( config, userKey );
		await saveSharedConfig( config );
		return connections;
	} finally {
		await unlockSharedConfig();
	}
}

export async function removeAllConnectedWpcomSitesForLocalSite(
	localSiteId: string
): Promise< void > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		// A deleted local site cannot be recovered by signing into a different account.
		for ( const userKey of Object.keys( config.connectedWpcomSites ?? {} ) ) {
			const connections = getConnectionsForUser( config, userKey );
			config.connectedWpcomSites![ userKey ] = connections.filter(
				( connection ) => connection.localSiteId !== localSiteId
			);
			pruneEmptyConnectionsForUser( config, userKey );
		}
		await saveSharedConfig( config );
	} finally {
		await unlockSharedConfig();
	}
}

/**
 * Updates specific connection entries in place (matched by remote site id and
 * local site id) for the current user. Entries that don't match an existing
 * connection are skipped — use `addConnectedWpcomSite` to create new ones.
 */
export async function updateConnectedWpcomSites(
	localSiteId: string,
	updates: SyncSite[]
): Promise< SyncSite[] > {
	const userKey = await getCurrentUserKey();
	if ( ! userKey ) {
		return [];
	}

	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const connections = getConnectionsForUser( config, userKey );
		applyConnectionUpdates( connections, localSiteId, updates );
		await saveSharedConfig( config );
		return connections;
	} finally {
		await unlockSharedConfig();
	}
}

/**
 * Convenience: stamp the push or pull timestamp for a single connection.
 * Used by CLI push/pull after success so the Desktop UI shows an up-to-date
 * "Last synced" without needing its own write path.
 */
export async function markConnectedWpcomSiteSynced(
	localSiteId: string,
	remoteSiteId: number,
	direction: 'push' | 'pull'
): Promise< void > {
	const userKey = await getCurrentUserKey();
	if ( ! userKey ) {
		return;
	}
	const timestamp = new Date().toISOString();

	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const connections = getConnectionsForUser( config, userKey );
		if ( connections.length === 0 ) {
			return;
		}
		stampConnectionSynced( connections, localSiteId, remoteSiteId, direction, timestamp );
		await saveSharedConfig( config );
	} finally {
		await unlockSharedConfig();
	}
}
