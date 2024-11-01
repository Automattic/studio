import { renderHook, waitFor } from '@testing-library/react';
import { useAuth } from '../use-auth';
import { useFetchWpComSites } from '../use-fetch-wpcom-sites';
import { useSiteDetails } from '../use-site-details';
import { useSiteSyncManagement } from '../use-site-sync-management';

jest.mock( '../use-auth' );
jest.mock( '../use-site-details' );
jest.mock( '../use-fetch-wpcom-sites' );
jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getConnectedWpcomSites: jest.fn().mockResolvedValue( mockConnectedWpcomSites ),
		connectWpcomSite: jest
			.fn()
			.mockResolvedValue( [ ...mockConnectedWpcomSites, { id: 6, stagingSiteIds: [] } ] ),
		disconnectWpcomSite: jest.fn().mockResolvedValue( mockConnectedWpcomSites.slice( 1 ) ),
	} ),
} ) );
export const mockConnectedWpcomSites = [
	{
		id: 6,
		localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		name: 'My simple business site',
		url: 'https://developer.wordpress.com/studio/',
		isStaging: false,
		stagingSiteIds: [ 7 ],
		syncSupport: 'syncable',
	},
	{
		id: 7,
		localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		name: 'Staging: My simple business site',
		url: 'https://developer-staging.wordpress.com/studio/',
		isStaging: true,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
];

export const ConnectedSitesStore = {
	connectedWpcomSites: {
		'99440446': mockConnectedWpcomSites,
	},
};

const mockSyncSites = [
	{
		id: 6,
		name: 'My simple business site',
		url: 'https://developer.wordpress.com/studio/',
		isStaging: false,
		stagingSiteIds: [ 7 ],
		syncSupport: 'syncable',
	},
	{
		id: 7,
		name: 'Staging: My simple business site',
		url: 'https://developer-staging.wordpress.com/studio/',
		isStaging: true,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
];

describe( 'useSiteSyncManagement', () => {
	beforeEach( () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite: { id: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c' },
		} );
		( useFetchWpComSites as jest.Mock ).mockReturnValue( {
			syncSites: mockSyncSites,
			isFetching: false,
		} );
	} );

	afterEach( () => {
		jest.resetAllMocks();
	} );

	it( 'loads connected sites on mount when authenticated', async () => {
		const { result } = renderHook( () => useSiteSyncManagement() );

		await waitFor( () => {
			expect( result.current.connectedSites ).toEqual( mockConnectedWpcomSites );
		} );
	} );

	it( 'does not load connected sites when not authenticated', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		const { result } = renderHook( () => useSiteSyncManagement() );

		await waitFor( () => {
			expect( result.current.connectedSites ).toEqual( [] );
		} );
	} );
} );
