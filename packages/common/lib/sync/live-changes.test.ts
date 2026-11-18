import { describe, expect, it } from 'vitest';
import { getLastSyncTime, getLiveChangesMessage, hasLiveChanges } from './live-changes';

describe( 'getLastSyncTime', () => {
	it( 'takes the later of the last pull and the last push', () => {
		expect(
			getLastSyncTime( {
				lastPullTimestamp: '2026-11-03T10:00:00.000Z',
				lastPushTimestamp: '2026-11-01T10:00:00.000Z',
			} )
		).toBe( '2026-11-03T10:00:00.000Z' );
		expect(
			getLastSyncTime( { lastPullTimestamp: null, lastPushTimestamp: '2026-11-01T10:00:00.000Z' } )
		).toBe( '2026-11-01T10:00:00.000Z' );
	} );

	it( 'has nothing for a connection never synced', () => {
		expect( getLastSyncTime( { lastPullTimestamp: null, lastPushTimestamp: null } ) ).toBe(
			undefined
		);
		expect( getLastSyncTime( undefined ) ).toBe( undefined );
	} );
} );

describe( 'getLiveChangesMessage', () => {
	it.each( [
		[ { posts: 1, comments: 0 }, '1 post or page changed on Live' ],
		[ { posts: 0, comments: 3 }, '3 comments changed on Live' ],
		[ { posts: 2, comments: 1 }, '2 posts or pages and 1 comment changed on Live' ],
	] )( 'names what changed in %o', ( changes, expected ) => {
		expect( getLiveChangesMessage( 'Live', changes ) ).toContain( expected );
	} );
} );

describe( 'hasLiveChanges', () => {
	it( 'is true when anything changed', () => {
		expect( hasLiveChanges( { posts: 0, comments: 0 } ) ).toBe( false );
		expect( hasLiveChanges( { posts: 0, comments: 1 } ) ).toBe( true );
	} );
} );
