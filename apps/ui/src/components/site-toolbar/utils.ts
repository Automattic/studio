import { __ } from '@wordpress/i18n';
import type { Snapshot, SyncSite } from '@/data/core';

export function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function ensureProtocol( url: string ): string {
	return /^https?:\/\//.test( url ) ? url : `https://${ url }`;
}

function lastSyncedAt( site: SyncSite ): number {
	const push = Date.parse( site.lastPushTimestamp ?? '' );
	const pull = Date.parse( site.lastPullTimestamp ?? '' );
	return Math.max( Number.isFinite( push ) ? push : 0, Number.isFinite( pull ) ? pull : 0 );
}

/**
 * The connection the toolbar's status reports on. Nothing is "selected" any
 * more — push and pull each name their own target — so the status speaks for
 * whichever connection was touched most recently, falling back to production
 * for a site that has never synced anywhere.
 */
export function pickStatusConnection(
	connectedSites: SyncSite[] | undefined
): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	const [ mostRecent ] = [ ...connectedSites ].sort(
		( a, b ) => lastSyncedAt( b ) - lastSyncedAt( a )
	);
	if ( mostRecent && lastSyncedAt( mostRecent ) > 0 ) {
		return mostRecent;
	}
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

/**
 * Connections in the order a picker should list them: production first, then
 * staging, each group alphabetical so the list doesn't reshuffle between
 * fetches.
 */
export function sortConnections( connectedSites: SyncSite[] | undefined ): SyncSite[] {
	return [ ...( connectedSites ?? [] ) ].sort( ( a, b ) => {
		if ( a.isStaging !== b.isStaging ) {
			return a.isStaging ? 1 : -1;
		}
		return a.name.localeCompare( b.name );
	} );
}

/** What to call a connection in a list where its sibling is right beside it. */
export function getConnectionLabel( connectedSite: SyncSite ): string {
	return connectedSite.isStaging ? __( 'Staging' ) : __( 'Production' );
}

export function pickLatestSnapshot(
	snapshots: Snapshot[] | undefined,
	siteId: string
): Snapshot | undefined {
	if ( ! snapshots ) {
		return undefined;
	}
	// `date` is a unix timestamp; the most recent snapshot wins.
	return snapshots
		.filter( ( snapshot ) => snapshot.localSiteId === siteId )
		.reduce< Snapshot | undefined >( ( latest, candidate ) => {
			if ( ! latest || candidate.date > latest.date ) {
				return candidate;
			}
			return latest;
		}, undefined );
}

// `Snapshot.url` is stored as a bare hostname. The CLI `preview update`
// subcommand expects that same hostname as its positional arg, so use this
// helper when passing a snapshot back to publish/update actions — otherwise
// an `https://…/` prefix would cause the command to spawn a new preview.
export function getSnapshotHostname( snapshot: Snapshot ): string {
	return stripProtocol( snapshot.url );
}
