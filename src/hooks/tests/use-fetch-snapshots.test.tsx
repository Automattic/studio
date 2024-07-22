// To run tests, execute `npm run test -- src/hooks/tests/use-fetch-snapshots.test.tsx` from the root directory
import * as Sentry from '@sentry/electron/renderer';
import { waitFor, renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { useAuth } from '../use-auth';
import { useOffline } from '../use-offline';
import { useSnapshots, SnapshotProvider } from '../use-snapshots';

jest.mock( '@sentry/electron/renderer' );
jest.mock( '../use-auth' );
jest.mock( '../../hooks/use-offline' );
jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getSnapshots: jest.fn().mockResolvedValue( [] ),
		saveSnapshotsToStorage: jest.fn(),
	} ),
} ) );

const wrapper = ( { children }: { children: ReactNode } ) => (
	<SnapshotProvider>{ children }</SnapshotProvider>
);

describe( 'useFetchSnapshots', () => {
	// Mock data and responses
	const clientReqGet = jest.fn();
	beforeEach( () => {
		jest.resetAllMocks();
		( useOffline as jest.Mock ).mockReturnValue( false );
	} );

	it( 'sets initial state correctly when client is not available', async () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: null,
		} ) );
		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await act( async () => {
			expect( result.current.loadingServerSnapshots ).toBe( false );
			expect( result.current.snapshots ).toEqual( [] );
		} );
	} );

	it( 'handles fetch snapshots failure', async () => {
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
			expect( result.current.loadingServerSnapshots ).toBe( false );
			expect( Sentry.captureException ).toHaveBeenCalledWith( error );
			expect( result.current.snapshots ).toEqual( [] );
		} );
	} );

	it( 'fetches snapshots on mount when client is available', async () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockResolvedValue( {
						sites: [
							{ atomic_site_id: 12345 },
							{ atomic_site_id: 67890 },
							{ atomic_site_id: 13579 },
						],
					} ),
				},
			},
		} );

		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );

		await act( async () => {
			await waitFor( () => {
				expect( result.current.loadingServerSnapshots ).toBe( false );
				expect( clientReqGet ).toHaveBeenCalled();
				expect( result.current.allSnapshots ).toEqual( [
					{ atomicSiteId: 12345 },
					{ atomicSiteId: 67890 },
					{ atomicSiteId: 13579 },
				] );
			} ); // Increase timeout if needed
		} );
	} );

	it( 'should not check for snapshots when lacking an internet connection', async () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockResolvedValue( { sites: [] } ),
				},
			},
		} );
		( useOffline as jest.Mock ).mockReturnValue( true );
		const { result } = renderHook( () => useSnapshots(), { wrapper } );
		await waitFor( () => expect( result.current.initiated ).toBeTruthy() );
		act( () => {
			expect( clientReqGet ).not.toHaveBeenCalled();
		} );
	} );
} );
