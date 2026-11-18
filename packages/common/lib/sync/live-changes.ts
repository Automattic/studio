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
 * The later of a connection's last pull and last push: as far as Studio knows, the live database
 * matched the local one then. Undefined for a connection never synced.
 */
export function getLastSyncTime(
	connection: { lastPullTimestamp?: string | null; lastPushTimestamp?: string | null } | undefined
): string | undefined {
	return [ connection?.lastPullTimestamp, connection?.lastPushTimestamp ]
		.filter( ( time ): time is string => !! time )
		.sort()
		.at( -1 );
}

export function hasLiveChanges( { posts, comments }: LiveChanges ): boolean {
	return posts > 0 || comments > 0;
}

export function getLiveChangesMessage(
	siteName: string,
	{ posts, comments }: LiveChanges
): string {
	const postsText = sprintf( _n( '%d post or page', '%d posts or pages', posts ), posts );
	const commentsText = sprintf( _n( '%d comment', '%d comments', comments ), comments );
	let changed: string = posts ? postsText : commentsText;
	if ( posts && comments ) {
		changed = sprintf(
			/* translators: 1: number of posts or pages, 2: number of comments */
			__( '%1$s and %2$s' ),
			postsText,
			commentsText
		);
	}
	return sprintf(
		/* translators: 1: what changed, such as "2 posts or pages and 5 comments", 2: site name */
		__(
			'%1$s changed on %2$s since your last sync. Publishing the database replaces the live one, so those changes would be lost.'
		),
		changed,
		siteName
	);
}
