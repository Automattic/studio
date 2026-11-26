export const REMOTE_SITES_QUERY_KEY = [ 'remote-sites' ] as const;
export const ACCOUNT_SITES_QUERY_KEY = [ 'account-sites' ] as const;
export const SNAPSHOTS_QUERY_KEY = [ 'snapshots' ] as const;
export const SNAPSHOT_USAGE_QUERY_KEY = [ 'snapshot-usage' ] as const;

// Removed (not just invalidated) on auth transitions so a different user
// never sees stale data from the persisted cache.
export const USER_SCOPED_QUERY_KEYS: ReadonlyArray< readonly string[] > = [
	ACCOUNT_SITES_QUERY_KEY,
	REMOTE_SITES_QUERY_KEY,
	SNAPSHOTS_QUERY_KEY,
	SNAPSHOT_USAGE_QUERY_KEY,
	[ 'site-publish-status' ],
	[ 'destination-changes' ],
	[ 'publish-target' ],
	[ 'site-visibility' ],
	[ 'preview-status' ],
];
