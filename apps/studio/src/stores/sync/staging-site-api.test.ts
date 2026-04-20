import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { stagingSiteApi } from './staging-site-api';

vi.mock( 'src/lib/get-ipc-api' );

function makeStore() {
	return configureStore( {
		reducer: { [ stagingSiteApi.reducerPath ]: stagingSiteApi.reducer },
		middleware: ( g ) => g().concat( stagingSiteApi.middleware ),
	} );
}

describe( 'stagingSiteApi', () => {
	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'listStagingSites delegates to IPC', async () => {
		const listStagingSites = vi.fn().mockResolvedValue( [] );
		vi.mocked( getIpcApi ).mockReturnValue( { listStagingSites } as any );
		const store = makeStore();
		await store.dispatch(
			stagingSiteApi.endpoints.listStagingSites.initiate( { productionSiteId: 42 } )
		);
		expect( listStagingSites ).toHaveBeenCalledWith( { productionSiteId: 42 } );
	} );

	it( 'createStagingSite delegates to IPC', async () => {
		const createStagingSite = vi.fn().mockResolvedValue( { id: 1, name: 's', url: 'u' } );
		vi.mocked( getIpcApi ).mockReturnValue( { createStagingSite } as any );
		const store = makeStore();
		await store.dispatch(
			stagingSiteApi.endpoints.createStagingSite.initiate( { productionSiteId: 42 } )
		);
		expect( createStagingSite ).toHaveBeenCalledWith( { productionSiteId: 42 } );
	} );

	it( 'pushToStaging delegates to IPC', async () => {
		const pushToStaging = vi.fn().mockResolvedValue( { ok: true } );
		vi.mocked( getIpcApi ).mockReturnValue( { pushToStaging } as any );
		const store = makeStore();
		await store.dispatch(
			stagingSiteApi.endpoints.pushToStaging.initiate( {
				productionSiteId: 42,
				stagingSiteId: 77,
				options: [ 'sqls' ],
			} )
		);
		expect( pushToStaging ).toHaveBeenCalled();
	} );
} );
