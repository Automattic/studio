/**
 * @vitest-environment node
 */
import {
	hasActiveSyncOperations,
	hasCancellableSyncOperations,
	trackSyncActivity,
} from 'src/lib/active-sync-operations';

describe( 'sync operations tracked for the quit warning', () => {
	it( 'follows a push from cancellable, to running remotely, to finished', () => {
		trackSyncActivity( {
			siteId: 'site-1',
			activity: { kind: 'pending', direction: 'push', phase: 'uploading' },
		} );
		expect( hasActiveSyncOperations() ).toBe( true );
		expect( hasCancellableSyncOperations() ).toBe( true );

		trackSyncActivity( {
			siteId: 'site-1',
			activity: { kind: 'pending', direction: 'push', phase: 'applyingChanges' },
		} );
		expect( hasActiveSyncOperations() ).toBe( true );
		expect( hasCancellableSyncOperations() ).toBe( false );

		trackSyncActivity( { siteId: 'site-1', activity: { kind: 'success', direction: 'push' } } );
		expect( hasActiveSyncOperations() ).toBe( false );
	} );
} );
