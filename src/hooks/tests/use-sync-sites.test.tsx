import { renderHook, waitFor } from '@testing-library/react';
import { SyncSitesProvider, useSyncSites } from '../sync-sites';
import { useAuth } from '../use-auth';
import { useFetchWpComSites } from '../use-fetch-wpcom-sites';
import { useSiteDetails } from '../use-site-details';

jest.mock( '../use-auth' );
jest.mock( '../use-site-details' );
jest.mock( '../use-fetch-wpcom-sites' );

const mockConnectedWpcomSites = [
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

const mockSyncSites = [
	{
		id: 8,
		localSiteId: '',
		name: 'My simple store',
		url: 'https://developer.wordpress.com/studio/store',
		isStaging: false,
		stagingSiteIds: [ 9 ],
		syncSupport: 'syncable',
	},
	{
		id: 9,
		localSiteId: '',
		name: 'Staging: My simple test store',
		url: 'https://developer-staging.wordpress.com/studio/test-store',
		isStaging: true,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
];

const disconnectWpcomSiteMock = jest.fn().mockResolvedValue( [] );
const connectWpcomSiteMock = jest
	.fn()
	.mockResolvedValue( [ ...mockConnectedWpcomSites, { id: 6, stagingSiteIds: [] } ] );

jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getConnectedWpcomSites: jest.fn().mockResolvedValue( mockConnectedWpcomSites ),
		connectWpcomSite: connectWpcomSiteMock,
		disconnectWpcomSite: disconnectWpcomSiteMock,
		updateConnectedWpcomSites: jest.fn(),
	} ),
} ) );

describe( 'useSyncSites management', () => {
	const wrapper = ( { children }: { children: React.ReactNode } ) => (
		<SyncSitesProvider>{ children }</SyncSitesProvider>
	);

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
		jest.clearAllMocks();
	} );

	it( 'loads connected sites on mount when authenticated', async () => {
		const { result } = renderHook( () => useSyncSites(), { wrapper } );

		await waitFor( () => {
			expect( result.current.connectedSites ).toEqual( mockConnectedWpcomSites );
		} );
	} );

	it( 'does not load connected sites when not authenticated', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		const { result } = renderHook( () => useSyncSites(), { wrapper } );

		await waitFor( () => {
			expect( result.current.connectedSites ).toEqual( [] );
		} );
	} );

	it( 'connects a site and its staging sites successfully', async () => {
		const { result } = renderHook( () => useSyncSites(), { wrapper } );
		const siteToConnect = mockSyncSites[ 0 ];

		await waitFor( async () => {
			await result.current.connectSite( {
				...siteToConnect,
				syncSupport: 'syncable',
			} );
		} );

		await waitFor( () => {
			expect( connectWpcomSiteMock ).toHaveBeenCalledWith(
				[ siteToConnect, mockSyncSites[ 1 ] ],
				'788a7e0c-62d2-427e-8b1a-e6d5ac84b61c'
			);
		} );
	} );

	it( 'disconnects a site and its staging sites successfully', async () => {
		const { result } = renderHook( () => useSyncSites(), { wrapper } );
		const siteToDisconnect = mockConnectedWpcomSites[ 0 ];

		await waitFor( () => {
			expect( result.current.connectedSites ).toBeDefined();
			expect( result.current.connectedSites ).toEqual( mockConnectedWpcomSites );
		} );

		await waitFor( async () => {
			await result.current.disconnectSite( siteToDisconnect.id );
		} );

		expect( disconnectWpcomSiteMock ).toHaveBeenCalledWith(
			[ siteToDisconnect.id, ...siteToDisconnect.stagingSiteIds ],
			'788a7e0c-62d2-427e-8b1a-e6d5ac84b61c'
		);
	} );
} );
