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
