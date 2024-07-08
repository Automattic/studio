// To run tests, execute `npm run test -- src/hooks/tests/use-delete-snapshot.test.tsx` from the root directory
import * as Sentry from '@sentry/electron/renderer';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { useAuth } from '../use-auth';
import { useOffline } from '../use-offline';
import { SnapshotProvider, useSnapshots } from '../use-snapshots';

jest.mock( '@sentry/electron/renderer' );
jest.mock( '../use-auth' );
jest.mock( '../use-offline' );

const mockSnapshots = [ { atomicSiteId: 12345 }, { atomicSiteId: 67890 } ];
const mockSnapshot = { atomicSiteId: 12345 };

jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getSnapshots: jest.fn().mockResolvedValue( mockSnapshots ),
		saveSnapshotsToStorage: jest.fn(),
	} ),
} ) );

// Mock API calls
const mockDeleteSnapshot = jest.fn().mockResolvedValue( { message: 'Site deleted successfully.' } );
const mockGetSnapshotStatus = jest.fn().mockResolvedValue( { is_deleted: '1' } );
const mockFetchSnapshots = jest.fn().mockResolvedValue( {
	sites: mockSnapshots.map( ( s ) => ( { atomic_site_id: s.atomicSiteId } ) ),
} );
const mockFetchUsage = jest
	.fn()
	.mockResolvedValue( { site_count: mockSnapshots.length, site_limit: 10 } );

// Mock the client with specific implementations for different API calls
const mockClient = {
	req: {
		post: jest.fn( ( options ) => {
			if ( options.path === '/jurassic-ninja/delete' ) {
				return mockDeleteSnapshot( options );
			}
			return Promise.resolve( {} );
		} ),
		get: jest.fn( ( options ) => {
			const path: string = typeof options === 'string' ? options : options.path;
			if ( path === '/jurassic-ninja/status' ) {
				return mockGetSnapshotStatus( options );
			} else if ( path === '/jurassic-ninja/list' ) {
				return mockFetchSnapshots();
			} else if ( path === '/jurassic-ninja/usage' ) {
				return mockFetchUsage();
			}
			return Promise.resolve( {} );
		} ),
	},
};

( useAuth as jest.Mock ).mockImplementation( () => ( {
	client: mockClient,
} ) );

( useOffline as jest.Mock ).mockReturnValue( false );

jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getSnapshots: jest.fn().mockResolvedValue( mockSnapshots ),
		saveSnapshotsToStorage: jest.fn(),
	} ),
} ) );

const wrapper = ( { children }: { children: ReactNode } ) => (
	<SnapshotProvider>{ children }</SnapshotProvider>
);

describe( 'useSnapshots (delete functionality)', () => {
	beforeEach( () => {
		jest.useFakeTimers();
	} );

	afterEach( () => {
		jest.clearAllMocks();
		jest.useRealTimers();
	} );

	it( 'deletes a snapshot and updates state correctly', async () => {
		const { result } = renderHook( () => useSnapshots(), { wrapper } );

		await waitFor( () => expect( result.current.initiated ).toBe( true ) );

		const initialSnapshotsLength = result.current.snapshots.length;

		await act( async () => {
			await result.current.deleteSnapshot( mockSnapshots[ 0 ] );
		} );

		await waitFor( () => {
			expect( mockDeleteSnapshot ).toHaveBeenCalled();
		} );

		// Advance timers to trigger the status check
		act( () => {
			jest.advanceTimersByTime( 5000 );
		} );

		await waitFor( () => {
			expect( mockGetSnapshotStatus ).toHaveBeenCalled();
			// Check that the snapshot was removed from the state
			expect( result.current.snapshots.length ).toBe( initialSnapshotsLength - 1 );
			expect( result.current.snapshots ).not.toContainEqual(
				expect.objectContaining( mockSnapshots[ 0 ] )
			);
		} );
	} );

	it( 'deletes all snapshots and updates state correctly', async () => {
		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );

		await act( async () => {
			await result.current.deleteAllSnapshots( mockSnapshots );
		} );

		act( () => {
			jest.advanceTimersByTime( 8000 );
		} );

		act( () => {
			expect( result.current.loadingDeletingAllSnapshots ).toBe( false );
			expect( mockDeleteSnapshot ).toHaveBeenCalledTimes( mockSnapshots.length );
			expect( mockGetSnapshotStatus ).toHaveBeenCalledTimes( mockSnapshots.length );
			mockSnapshots.forEach( ( snapshot, index ) => {
				expect( mockDeleteSnapshot ).toHaveBeenNthCalledWith( index + 1, {
					apiNamespace: 'wpcom/v2',
					body: { site_id: snapshot.atomicSiteId },
					path: '/jurassic-ninja/delete',
				} );
			} );
		} );
		waitFor( () => expect( result.current.snapshots ).toHaveLength( 0 ) );
	} );

	it( 'handles failed status checks gracefully', async () => {
		mockDeleteSnapshot.mockRejectedValue( { message: 'Intentional server failure' } );
		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );

		await act( async () => {
			await result.current.deleteSnapshot( mockSnapshot );
		} );

		act( () => {
			jest.advanceTimersByTime( 8000 );
		} );

		expect( Sentry.captureException ).toHaveBeenCalled();
	} );

	it( 'does not check demo site statuses when offline', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );

		await act( async () => {
			await result.current.deleteSnapshot( mockSnapshot );
			jest.advanceTimersByTime( 3000 );
		} );

		expect( mockGetSnapshotStatus ).not.toHaveBeenCalled();
	} );
} );
