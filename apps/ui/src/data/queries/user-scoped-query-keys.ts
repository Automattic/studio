import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';

export const SYNCABLE_WPCOM_SITES_QUERY_KEY = [ 'syncable-wpcom-sites' ] as const;
export const ALL_CONNECTED_WPCOM_SITES_QUERY_KEY = [ 'all-connected-wpcom-sites' ] as const;
export const SNAPSHOTS_QUERY_KEY = [ 'snapshots' ] as const;
export const SNAPSHOT_USAGE_QUERY_KEY = [ 'snapshot-usage' ] as const;

// Removed (not just invalidated) on auth transitions so a different user
// never sees stale data from the persisted cache.
export const USER_SCOPED_QUERY_KEYS: ReadonlyArray< readonly string[] > = [
	SYNCABLE_WPCOM_SITES_QUERY_KEY,
	ALL_CONNECTED_WPCOM_SITES_QUERY_KEY,
	connectedWpcomSitesQueryKey( '' ).slice( 0, 1 ),
	SNAPSHOTS_QUERY_KEY,
	SNAPSHOT_USAGE_QUERY_KEY,
];
