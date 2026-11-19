import { __, _n, sprintf } from '@wordpress/i18n';
import type { LiveChanges } from '@studio/providers';

// Kept free of Node imports: the CLI's push and Studio on the web's both check the live site
// before replacing its database.

// The code of a push refused because the live site changed since the last sync.
export const LIVE_CHANGED_CODE = 'live_changed';

export class LiveChangesError extends Error {
	readonly code = LIVE_CHANGED_CODE;

	constructor( message: string ) {
		super( message );
		this.name = 'LiveChangesError';
	}
}

/**
 * When, as far as Studio knows, the live database last matched the local one: the connection's
 * last pull or push that included the database. A connection saved before those were recorded
 * falls back to its last pull or push of any kind. Undefined when no sync included the database.
 */
export function getLastSyncTime(
	connection:
		| {
				lastPullTimestamp?: string | null;
				lastPushTimestamp?: string | null;
				lastDatabaseSyncTimestamp?: string | null;
		  }
		| undefined
): string | undefined {
	if ( connection?.lastDatabaseSyncTimestamp !== undefined ) {
		return connection.lastDatabaseSyncTimestamp ?? undefined;
	}
	return [ connection?.lastPullTimestamp, connection?.lastPushTimestamp ]
		.filter( ( time ): time is string => !! time )
		.sort()
		.at( -1 );
}

function hasLiveChanges( { posts, comments, siteDesign }: LiveChanges ): boolean {
	return posts > 0 || comments > 0 || siteDesign > 0;
}

// Posts, pages and media count as content; templates, template parts, menus, synced patterns and
// global styles as design.
function getLiveChangesMessage(
	siteName: string,
	{ posts, comments, siteDesign }: LiveChanges
): string {
	const parts = [
		posts ? sprintf( _n( '%d content change', '%d content changes', posts ), posts ) : '',
		siteDesign
			? sprintf( _n( '%d design change', '%d design changes', siteDesign ), siteDesign )
			: '',
		comments ? sprintf( _n( '%d new comment', '%d new comments', comments ), comments ) : '',
	].filter( Boolean );
	let changed: string = parts[ 0 ] ?? '';
	if ( parts.length === 2 ) {
		changed = sprintf(
			/* translators: 1: and 2: counts, such as "2 content changes" and "1 new comment" */
			__( '%1$s and %2$s' ),
			parts[ 0 ],
			parts[ 1 ]
		);
	} else if ( parts.length === 3 ) {
		changed = sprintf(
			/* translators: 1:, 2: and 3: counts, such as "2 content changes", "3 design changes" and "1 new comment" */
			__( '%1$s, %2$s and %3$s' ),
			parts[ 0 ],
			parts[ 1 ],
			parts[ 2 ]
		);
	}
	return sprintf(
		/* translators: 1: site name, 2: what changed, such as "2 content changes and 5 new comments" */
		__(
			'Since your last sync, %1$s has %2$s. Publishing the database replaces the live one, so those changes would be lost.'
		),
		siteName,
		changed
	);
}

type SyncedConnection = Parameters< typeof getLastSyncTime >[ 0 ];

/** What the live-changes check found before a push that replaces the live database. */
export type LiveChangesCheck =
	// No sync of this connection included the database, so there is nothing to compare with.
	| { kind: 'skipped' }
	| { kind: 'unchanged' }
	// Something changed live: refuse the push, or ask, with `message`.
	| { kind: 'changed'; message: string }
	// The check itself failed. The push goes ahead, and the user should see `warning`.
	| { kind: 'failed'; warning: string };

/**
 * Asks the live site what changed since the connection's last database sync. Every Studio app
 * runs this before a push that includes the database, and decides what to do with the result.
 */
export async function checkLiveChanges( {
	connection,
	siteName,
	fetchChanges,
}: {
	connection: SyncedConnection;
	siteName: string;
	fetchChanges: ( since: string ) => Promise< LiveChanges >;
} ): Promise< LiveChangesCheck > {
	const since = getLastSyncTime( connection );
	if ( ! since ) {
		return { kind: 'skipped' };
	}
	let changes: LiveChanges;
	try {
		changes = await fetchChanges( since );
	} catch ( error ) {
		return {
			kind: 'failed',
			warning: sprintf(
				/* translators: 1: site name, 2: error message */
				__(
					'Could not check %1$s for changes made since your last sync, so the push went ahead without that check (%2$s).'
				),
				siteName,
				error instanceof Error ? error.message : String( error )
			),
		};
	}
	return hasLiveChanges( changes )
		? { kind: 'changed', message: getLiveChangesMessage( siteName, changes ) }
		: { kind: 'unchanged' };
}
