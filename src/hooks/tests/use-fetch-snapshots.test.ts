// To run tests, execute `npm run test -- src/hooks/tests/use-fetch-snapshots.test.ts` from the root directory
import * as Sentry from '@sentry/electron/renderer';
import { waitFor, renderHook } from '@testing-library/react';
import { useOffline } from '../../hooks/use-offline';
import { useAuth } from '../use-auth';
import { useFetchSnapshots } from '../use-fetch-snaphsots';
import { useSiteUsage } from '../use-site-usage';

jest.mock( '@sentry/electron/renderer' );
jest.mock( '../use-auth' );
jest.mock( '../use-site-usage' );

describe( 'useFetchSnapshots', () => {
	// Mock data and responses
	const clientReqGet = jest.fn();

	beforeEach( () => {
		jest.resetAllMocks();
		( useSiteUsage as jest.Mock ).mockReturnValue( { siteCount: 1 } );
	} );
	it( 'sets initial state correctly when client is not available', async () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: null,
		} ) );
		const { result } = renderHook( () => useFetchSnapshots() );

		expect( result.current.isLoading ).toBe( false );
		expect( result.current.allSnapshots ).toBe( null );
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

		const { result } = renderHook( () => useFetchSnapshots() );

		await waitFor( () => {
			expect( result.current.isLoading ).toBe( false );
			expect( Sentry.captureException ).toHaveBeenCalledWith( error );
			expect( result.current.allSnapshots ).toBe( null );
		} );
	} );
	it( 'fetches snapshots on mount when client is available', async () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockResolvedValue( {
						sites: [
							{
								atomic_site_id: 12345,
							},
							{
								atomic_site_id: 67890,
							},
							{
								atomic_site_id: 13579,
							},
						],
					} ),
				},
			},
		} );

		const { result } = renderHook( () => useFetchSnapshots() );

		await waitFor( () => {
			expect( result.current.isLoading ).toBe( false );
			expect( clientReqGet ).toHaveBeenCalled();
			expect( result.current.allSnapshots ).toStrictEqual( [
				{ atomicSiteId: 12345 },
				{ atomicSiteId: 67890 },
				{ atomicSiteId: 13579 },
			] );
		} );
	} );

	it( 'should not check for snapshots when lacking an internet connection', () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockResolvedValue( { sites: [] } ),
				},
			},
		} );
		( useOffline as jest.Mock ).mockReturnValue( true );
		renderHook( () => useSiteUsage() );

		expect( clientReqGet ).not.toHaveBeenCalled();
	} );
} );
