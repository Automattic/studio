import { type SyncSite } from '../types/sync';
import {
	getCurrentUserId,
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from './shared-config';

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

async function updateConnectionsForUser(
	userId: number,
	updater: ( current: SyncSite[] ) => SyncSite[]
): Promise< SyncSite[] > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const byUser = { ...( config.connectedWpcomSites ?? {} ) };
		const current = byUser[ String( userId ) ] ?? [];
		const next = updater( current );
		if ( next.length === 0 ) {
			delete byUser[ String( userId ) ];
		} else {
			byUser[ String( userId ) ] = next;
		}
		await saveSharedConfig( {
			...config,
			connectedWpcomSites: Object.keys( byUser ).length > 0 ? byUser : undefined,
		} );
		return next;
	} finally {
		await unlockSharedConfig();
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
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	const config = await readSharedConfig().catch( () => null );
	const all = config?.connectedWpcomSites?.[ String( userId ) ] ?? [];
	return all.filter( ( site ) => site.localSiteId === localSiteId );
}

/**
 * Returns every connection stored for the current user, across all local
 * sites. Preserves the order entries appear in shared.json.
 */
export async function getAllConnectedWpcomSitesForCurrentUser(): Promise< SyncSite[] > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	const config = await readSharedConfig().catch( () => null );
	return config?.connectedWpcomSites?.[ String( userId ) ] ?? [];
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
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	return updateConnectionsForUser( userId, ( current ) => {
		const normalized = normalizeStoredSite(
			{ ...site, syncSupport: 'already-connected' },
			localSiteId
		);
		const existingIndex = current.findIndex(
			( c ) => c.id === normalized.id && c.localSiteId === localSiteId
		);
		if ( existingIndex === -1 ) {
			return [ ...current, normalized ];
		}
		const merged = [ ...current ];
		merged[ existingIndex ] = { ...current[ existingIndex ], ...normalized };
		return merged;
	} );
}

/**
 * Removes a WordPress.com site connection from a local site for the current
 * user. Safe to call when the connection doesn't exist.
 */
export async function removeConnectedWpcomSite(
	localSiteId: string,
	remoteSiteId: number
): Promise< SyncSite[] > {
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	return updateConnectionsForUser( userId, ( current ) =>
		current.filter( ( c ) => ! ( c.id === remoteSiteId && c.localSiteId === localSiteId ) )
	);
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
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return [];
	}
	return updateConnectionsForUser( userId, ( current ) => {
		const next = [ ...current ];
		for ( const update of updates ) {
			const idx = next.findIndex( ( c ) => c.id === update.id && c.localSiteId === localSiteId );
			if ( idx !== -1 ) {
				next[ idx ] = normalizeStoredSite( { ...next[ idx ], ...update }, localSiteId );
			}
		}
		return next;
	} );
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
	const userId = await getCurrentUserId();
	if ( ! userId ) {
		return;
	}
	const timestamp = new Date().toISOString();
	await updateConnectionsForUser( userId, ( current ) =>
		current.map( ( c ) => {
			if ( c.id !== remoteSiteId || c.localSiteId !== localSiteId ) {
				return c;
			}
			return direction === 'push'
				? { ...c, lastPushTimestamp: timestamp }
				: { ...c, lastPullTimestamp: timestamp };
		} )
	);
}
