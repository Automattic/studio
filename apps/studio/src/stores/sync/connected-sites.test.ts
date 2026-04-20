import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { connectedSitesApi } from './connected-sites';

vi.mock( 'src/lib/get-ipc-api' );

describe( 'useUpdateConnectedSiteSlotMutation', () => {
	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'calls the IPC handler and refetches connected sites', async () => {
		const update = vi.fn().mockResolvedValue( undefined );
		const list = vi.fn().mockResolvedValue( [] );
		vi.mocked( getIpcApi ).mockReturnValue( {
			updateConnectedSiteSlot: update,
			getConnectedWpcomSites: list,
		} as any );

		const store = configureStore( {
			reducer: { [ connectedSitesApi.reducerPath ]: connectedSitesApi.reducer },
			middleware: ( g ) => g().concat( connectedSitesApi.middleware ),
		} );

		await store.dispatch(
			connectedSitesApi.endpoints.updateConnectedSiteSlot.initiate( {
				localSiteId: 'local-1',
				siteId: 7,
				slotOverride: 'production',
			} )
		);

		expect( update ).toHaveBeenCalledWith( {
			localSiteId: 'local-1',
			siteId: 7,
			slotOverride: 'production',
		} );
		expect( list ).toHaveBeenCalledWith( 'local-1' );
	} );
} );

describe( 'useConnectSiteMutation slot enforcement', () => {
	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'returns SLOT_TAKEN when connecting a second production site', async () => {
		const connectWpcomSites = vi.fn().mockResolvedValue( undefined );
		const getConnectedWpcomSites = vi.fn().mockResolvedValue( [
			{
				id: 1,
				localSiteId: 'local-1',
				name: 'Existing prod',
				url: 'https://existing.example.com',
				isStaging: false,
				isPressable: false,
				environmentType: 'production',
				syncSupport: 'syncable',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		] );
		vi.mocked( getIpcApi ).mockReturnValue( {
			connectWpcomSites,
			getConnectedWpcomSites,
		} as any );

		const store = configureStore( {
			reducer: { [ connectedSitesApi.reducerPath ]: connectedSitesApi.reducer },
			middleware: ( g ) => g().concat( connectedSitesApi.middleware ),
		} );

		const result = await store.dispatch(
			connectedSitesApi.endpoints.connectSite.initiate( {
				localSiteId: 'local-1',
				site: {
					id: 2,
					localSiteId: 'local-1',
					name: 'New prod',
					url: 'https://new.example.com',
					isStaging: false,
					isPressable: false,
					environmentType: 'production',
					syncSupport: 'syncable',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
				},
			} )
		);

		expect( ( result as any ).error?.status ).toBe( 'SLOT_TAKEN' );
		expect( connectWpcomSites ).not.toHaveBeenCalled();
	} );
} );
