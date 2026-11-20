import { describe, expect, it, vi } from 'vitest';
import { checkLiveChanges, getLastSyncTime } from './live-changes';

const PULL = '2026-11-01T10:00:00.000Z';
const PUSH = '2026-11-03T10:00:00.000Z';

describe( 'getLastSyncTime', () => {
	it( 'uses the last sync that included the database', () => {
		expect(
			getLastSyncTime( {
				lastPullTimestamp: PULL,
				lastPushTimestamp: PUSH,
				lastDatabaseSyncTimestamp: PULL,
			} )
		).toBe( PULL );
	} );

	it( 'has nothing when no sync included the database', () => {
		expect(
			getLastSyncTime( {
				lastPullTimestamp: PULL,
				lastPushTimestamp: PUSH,
				lastDatabaseSyncTimestamp: null,
			} )
		).toBe( undefined );
	} );

	it( 'falls back to the later sync of any kind for a connection saved before database syncs were recorded', () => {
		expect( getLastSyncTime( { lastPullTimestamp: PUSH, lastPushTimestamp: PULL } ) ).toBe( PUSH );
		expect( getLastSyncTime( { lastPullTimestamp: null, lastPushTimestamp: PULL } ) ).toBe( PULL );
	} );

	it( 'has nothing for a connection never synced', () => {
		expect( getLastSyncTime( { lastPullTimestamp: null, lastPushTimestamp: null } ) ).toBe(
			undefined
		);
		expect( getLastSyncTime( undefined ) ).toBe( undefined );
	} );
} );

describe( 'checkLiveChanges', () => {
	const connection = { lastPullTimestamp: PULL, lastPushTimestamp: null };

	it( 'asks for changes since the last database sync', async () => {
		const fetchChanges = vi.fn( async () => ( { posts: 0, comments: 0, siteDesign: 0 } ) );

		await expect(
			checkLiveChanges( { connection, siteName: 'Live', fetchChanges } )
		).resolves.toEqual( { kind: 'unchanged' } );
		expect( fetchChanges ).toHaveBeenCalledWith( PULL );
	} );

	it( 'skips a connection with no database sync to compare with', async () => {
		const fetchChanges = vi.fn();

		await expect(
			checkLiveChanges( {
				connection: { ...connection, lastDatabaseSyncTimestamp: null },
				siteName: 'Live',
				fetchChanges,
			} )
		).resolves.toEqual( { kind: 'skipped' } );
		expect( fetchChanges ).not.toHaveBeenCalled();
	} );

	it.each( [
		[
			{ posts: 1, comments: 0, siteDesign: 0 },
			'Since your last sync, Live has 1 content change.',
		],
		[ { posts: 0, comments: 3, siteDesign: 0 }, 'Live has 3 new comments.' ],
		[ { posts: 0, comments: 0, siteDesign: 1 }, 'Live has 1 design change.' ],
		[ { posts: 2, comments: 1, siteDesign: 0 }, 'Live has 2 content changes and 1 new comment.' ],
		[
			{ posts: 2, comments: 1, siteDesign: 3 },
			'Live has 2 content changes, 3 design changes and 1 new comment.',
		],
	] )( 'names what changed in %o', async ( changes, expected ) => {
		const check = await checkLiveChanges( {
			connection,
			siteName: 'Live',
			fetchChanges: async () => changes,
		} );

		expect( check ).toEqual( { kind: 'changed', message: expect.stringContaining( expected ) } );
	} );

	it( 'reports a failed check as a warning, so the push can go ahead', async () => {
		const check = await checkLiveChanges( {
			connection,
			siteName: 'Live',
			fetchChanges: async () => {
				throw new Error( 'Forbidden' );
			},
		} );

		expect( check ).toEqual( {
			kind: 'failed',
			warning: expect.stringMatching( /Could not check Live.*\(Forbidden\)/ ),
		} );
	} );
} );
