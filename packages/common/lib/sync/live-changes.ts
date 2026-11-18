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

export function hasLiveChanges( { posts, comments, templates }: LiveChanges ): boolean {
	return posts > 0 || comments > 0 || templates > 0;
}

export function getLiveChangesMessage(
	siteName: string,
	{ posts, comments, templates }: LiveChanges
): string {
	const parts = [
		posts ? sprintf( _n( '%d post or page', '%d posts or pages', posts ), posts ) : '',
		templates
			? sprintf(
					_n( '%d template or template part', '%d templates or template parts', templates ),
					templates
			  )
			: '',
		comments ? sprintf( _n( '%d comment', '%d comments', comments ), comments ) : '',
	].filter( Boolean );
	let changed: string = parts[ 0 ] ?? '';
	if ( parts.length === 2 ) {
		changed = sprintf(
			/* translators: 1: and 2: numbers of things that changed, such as "2 posts or pages" */
			__( '%1$s and %2$s' ),
			parts[ 0 ],
			parts[ 1 ]
		);
	} else if ( parts.length === 3 ) {
		changed = sprintf(
			/* translators: 1:, 2: and 3: numbers of things that changed, such as "2 posts or pages" */
			__( '%1$s, %2$s and %3$s' ),
			parts[ 0 ],
			parts[ 1 ],
			parts[ 2 ]
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
