// To run tests, execute `npm run test -- src/hooks/tests/use-site-usage.test.ts` from the root directory
import * as Sentry from '@sentry/electron/renderer';
import { waitFor, renderHook } from '@testing-library/react';
import { LIMIT_OF_ZIP_SITES_PER_USER } from '../../constants';
import { useOffline } from '../../hooks/use-offline';
import { useAuth } from '../use-auth';
import { useSiteDetails } from '../use-site-details';
import { useSiteUsage } from '../use-site-usage';

jest.mock( '@sentry/electron/renderer' );
jest.mock( '../use-auth' );
jest.mock( '../use-site-details' );

describe( 'useSiteUsage', () => {
	// Mock data and responses
	const mockSnapshots = [ { atomicSiteId: 12345 }, { atomicSiteId: 67890 } ];
	const clientReqGet = jest.fn();

	beforeEach( () => {
		jest.resetAllMocks();
		( useSiteDetails as jest.Mock ).mockReturnValue( { snapshots: mockSnapshots } );
	} );
	it( 'sets initial state correctly when client is not available', async () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: null,
		} ) );
		const { result } = renderHook( () => useSiteUsage() );

		expect( result.current.isLoading ).toBe( false );
		expect( result.current.siteCount ).toBe( mockSnapshots.length );
		expect( result.current.siteLimit ).toBe( LIMIT_OF_ZIP_SITES_PER_USER );
	} );
	it( 'handles fetch site usage failure', async () => {
		const error = new Error( 'Failed to fetch' );
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockRejectedValue( error ),
				},
			},
		} );

		const { result } = renderHook( () => useSiteUsage() );

		await waitFor( () => {
			expect( result.current.isLoading ).toBe( false );
			expect( Sentry.captureException ).toHaveBeenCalledWith( error );
			expect( result.current.siteCount ).toBe( mockSnapshots.length );
			expect( result.current.siteLimit ).toBe( LIMIT_OF_ZIP_SITES_PER_USER );
		} );
	} );
	it( 'fetches site usage on mount when client is available', async () => {
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

		const { result } = renderHook( () => useSiteUsage() );

		await waitFor( () => {
			expect( result.current.isLoading ).toBe( false );
			expect( clientReqGet ).toHaveBeenCalled();
			expect( result.current.siteCount ).toBe( 3 );
			expect( result.current.siteLimit ).toBe( 15 );
		} );
	} );

	it( 'should not check usage when lacking an internet connection', () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					get: clientReqGet.mockResolvedValue( { site_count: 3, site_limit: 15 } ),
				},
			},
		} );
		( useOffline as jest.Mock ).mockReturnValue( true );
		renderHook( () => useSiteUsage() );

		expect( clientReqGet ).not.toHaveBeenCalled();
	} );
} );
