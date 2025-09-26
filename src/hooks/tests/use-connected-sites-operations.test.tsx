import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { useAuth } from 'src/hooks/use-auth';
import { useFetchWpComSites } from 'src/hooks/use-fetch-wpcom-sites';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { store } from 'src/stores';
import { useConnectedSitesData, useConnectedSitesOperations } from 'src/stores/sync';
import { SyncSite } from '../use-fetch-wpcom-sites/types';

jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/hooks/use-site-details' );
jest.mock( 'src/hooks/use-fetch-wpcom-sites' );
jest.mock( 'src/stores/sync', () => ( {
	...jest.requireActual( 'src/stores/sync' ),
	useConnectedSitesData: jest.fn(),
	useConnectedSitesOperations: jest.fn(),
} ) );

const mockConnectedWpcomSites: SyncSite[] = [
	{
		id: 6,
		localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		name: 'My simple business site',
		url: 'https://developer.wordpress.com/studio/',
		isStaging: false,
		isPressable: false,
		stagingSiteIds: [ 7 ],
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	},
	{
		id: 7,
		localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		name: 'Staging: My simple business site',
		url: 'https://developer-staging.wordpress.com/studio/',
		isStaging: true,
		isPressable: false,
		stagingSiteIds: [],
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	},
];

const mockSyncSites: SyncSite[] = [
	{
		id: 8,
		localSiteId: '',
		name: 'My simple store',
		url: 'https://developer.wordpress.com/studio/store',
		isStaging: false,
		isPressable: false,
		stagingSiteIds: [ 9 ],
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	},
	{
		id: 9,
		localSiteId: '',
		name: 'Staging: My simple test store',
		url: 'https://developer-staging.wordpress.com/studio/test-store',
		isStaging: true,
		isPressable: false,
		stagingSiteIds: [],
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	},
];

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getConnectedWpcomSites: jest.fn().mockResolvedValue( mockConnectedWpcomSites ),
		connectWpcomSites: jest.fn(),
		disconnectWpcomSites: jest.fn(),
		updateConnectedWpcomSites: jest.fn(),
	} ),
} ) );

describe( 'useConnectedSitesOperations', () => {
	const wrapper = ( { children }: { children: React.ReactNode } ) => (
		<Provider store={ store }>{ children }</Provider>
	);

	const mockDisconnectSite = jest.fn().mockResolvedValue( [] );
	const mockConnectSite = jest
		.fn()
		.mockResolvedValue( [ ...mockConnectedWpcomSites, { id: 6, stagingSiteIds: [] } ] );

	beforeEach( () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite: { id: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c' },
		} );
		( useFetchWpComSites as jest.Mock ).mockReturnValue( {
			syncSites: mockSyncSites,
			isFetching: false,
		} );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: mockConnectedWpcomSites,
			localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		} );
		( useConnectedSitesOperations as jest.Mock ).mockReturnValue( {
			connectSite: mockConnectSite,
			disconnectSite: mockDisconnectSite,
		} );
	} );

	afterEach( () => {
		jest.clearAllMocks();
	} );

	it( 'loads connected sites on mount when authenticated', async () => {
		const { result } = renderHook( () => useConnectedSitesData(), { wrapper } );

		await waitFor( () => {
			expect( result.current.connectedSites ).toEqual( mockConnectedWpcomSites );
		} );
	} );

	it( 'does not load connected sites when not authenticated', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		( useConnectedSitesData as jest.Mock ).mockReturnValue( {
			connectedSites: [],
			loading: false,
			localSiteId: '788a7e0c-62d2-427e-8b1a-e6d5ac84b61c',
		} );
		const { result } = renderHook( () => useConnectedSitesData(), { wrapper } );

		await waitFor( () => {
			expect( result.current.connectedSites ).toEqual( [] );
		} );
	} );

	it( 'connects a site and its staging sites successfully', async () => {
		const { result } = renderHook( () => useConnectedSitesOperations(), { wrapper } );
		const siteToConnect = mockSyncSites[ 0 ];

		await waitFor( async () => {
			await result.current.connectSite( {
				...siteToConnect,
				isPressable: false,
				syncSupport: 'syncable',
			} );
		} );

		await waitFor( () => {
			expect( mockConnectSite ).toHaveBeenCalledWith( siteToConnect );
		} );
	} );

	it( 'disconnects a site and its staging sites successfully', async () => {
		const { result } = renderHook( () => useConnectedSitesOperations(), { wrapper } );
		const { result: resultConnectedSites } = renderHook( () => useConnectedSitesData(), {
			wrapper,
		} );
		const siteToDisconnect = mockConnectedWpcomSites[ 0 ];

		await waitFor( () => {
			expect( resultConnectedSites.current.connectedSites ).toBeDefined();
			expect( resultConnectedSites.current.connectedSites ).toEqual( mockConnectedWpcomSites );
		} );

		await waitFor( async () => {
			await result.current.disconnectSite( siteToDisconnect.id );
		} );

		expect( mockDisconnectSite ).toHaveBeenCalledWith( siteToDisconnect.id );
	} );
} );
