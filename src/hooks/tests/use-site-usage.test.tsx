// To run tests, execute `npm run test -- src/hooks/tests/use-site-usage.test.ts` from the root directory
import * as Sentry from '@sentry/electron/renderer';
import { waitFor, renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { LIMIT_OF_ZIP_SITES_PER_USER } from '../../constants';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { useOffline } from '../use-offline';
import { useSnapshots, SnapshotProvider } from '../use-snapshots';

const wrapper = ( { children }: { children: ReactNode } ) => (
	<SnapshotProvider>{ children }</SnapshotProvider>
);

const mockSnapshots = [ { atomicSiteId: 12345 }, { atomicSiteId: 67890 } ];
jest.mock( '@sentry/electron/renderer' );
jest.mock( '../use-auth' );
jest.mock( '../../hooks/use-offline' );
jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getSnapshots: jest.fn().mockResolvedValue( mockSnapshots ),
		saveSnapshotsToStorage: jest.fn(),
	} ),
} ) );

describe( 'useSnapshots (site usage functionality)', () => {
	const clientReqGet = jest.fn();

	beforeEach( () => {
		jest.resetAllMocks();
	} );

	it( 'sets initial state correctly when client is not available', async () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: null,
		} ) );

		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );
		await act( async () => {
			await waitFor( () => {
				expect( result.current.isLoadingSnapshotUsage ).toBe( false );
				expect( result.current.activeSnapshotCount ).toBe( mockSnapshots.length );
				expect( result.current.snapshotQuota ).toBe( LIMIT_OF_ZIP_SITES_PER_USER );
			} );
		} );
	} );
	it( 'sets initial state correctly when client is not available', async () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: null,
		} ) );

		const { result } = renderHook( () => useSnapshots(), { wrapper } );

		await waitFor( () => expect( result.current.initiated ).toBe( true ) );
		await waitFor( () => expect( result.current.activeSnapshotCount > 0 ).toBeTruthy() );

		await waitFor( () => {
			expect( result.current.isLoadingSnapshotUsage ).toBe( false );
			expect( result.current.activeSnapshotCount ).toBe( mockSnapshots.length );
			expect( result.current.snapshotQuota ).toBe( LIMIT_OF_ZIP_SITES_PER_USER );
		} );
	} );

	it( 'handles fetch snapshot usage failure', async () => {
		const error = new Error( 'Failed to fetch' );
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockRejectedValue( error ),
				},
			},
		} );

		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );

		await waitFor( () => {
			expect( result.current.isLoadingSnapshotUsage ).toBe( false );
			expect( Sentry.captureException ).toHaveBeenCalledWith( error );
			expect( result.current.activeSnapshotCount ).toBe( mockSnapshots.length );
			expect( result.current.snapshotQuota ).toBe( LIMIT_OF_ZIP_SITES_PER_USER );
		} );
	} );
	it( 'fetches snapshot usage on mount when client is available', async () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockResolvedValue( {
						site_count: 3,
						site_limit: 15,
					} ),
				},
			},
		} );

		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );
		await act( async () => {
			await waitFor( () => {
				expect( result.current.isLoadingSnapshotUsage ).toBe( false );
				expect( clientReqGet ).toHaveBeenCalled();
				expect( result.current.activeSnapshotCount ).toBe( 3 );
				expect( result.current.snapshotQuota ).toBe( 15 );
			} );
		} );
	} );

	it( 'should not check usage when lacking an internet connection', async () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockResolvedValue( { site_count: 3, site_limit: 15 } ),
				},
			},
		} );
		( useOffline as jest.Mock ).mockReturnValue( true );
		( getIpcApi().getSnapshots as jest.Mock ).mockResolvedValue( mockSnapshots );

		await act( async () => {
			renderHook( () => useSnapshots(), { wrapper } );

			await waitFor( () => {
				expect( clientReqGet ).not.toHaveBeenCalled();
			} );
		} );
	} );
} );
