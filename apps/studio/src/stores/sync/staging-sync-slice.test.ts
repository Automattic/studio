import { configureStore } from '@reduxjs/toolkit';
import {
	fetchStagingSiteSyncState,
	stagingSyncReducer,
	startStagingSiteSync,
	type StagingSyncState,
} from 'src/stores/sync/staging-sync-slice';
import type { SyncSite } from '@studio/common/types/sync';

const { mockGetWpcomClient } = vi.hoisted( () => ( {
	mockGetWpcomClient: vi.fn(),
} ) );

vi.mock( 'src/stores/wpcom-api', () => ( {
	getWpcomClient: mockGetWpcomClient,
} ) );

const createSyncSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 101,
	localSiteId: '',
	name: 'Production Site',
	url: 'https://production.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

describe( 'staging sync reducer', () => {
	beforeEach( () => {
		mockGetWpcomClient.mockReset();
	} );

	it( 'tracks production-scoped staging sync state when a sync starts', () => {
		const productionSite = createSyncSite();
		const stagingSite = createSyncSite( {
			id: 202,
			isStaging: true,
			productionSiteId: 101,
		} );
		const action = startStagingSiteSync.pending( 'request-id', {
			productionSite,
			stagingSite,
			direction: 'push',
			options: [ 'themes', 'plugins' ],
		} );

		const state = stagingSyncReducer( undefined, action );

		expect( state.states[ 101 ] ).toMatchObject( {
			productionSiteId: 101,
			stagingSiteId: 202,
			status: 'started',
			direction: 'push',
			options: [ 'themes', 'plugins' ],
		} );
	} );

	it( 'does not let an empty sync-state response erase an active local state', () => {
		const activeState: StagingSyncState = {
			productionSiteId: 101,
			stagingSiteId: 202,
			status: 'started',
			direction: 'push',
		};

		const state = stagingSyncReducer(
			{ states: { 101: activeState } },
			fetchStagingSiteSyncState.fulfilled(
				{
					productionSiteId: 101,
					status: 'idle',
				},
				'request-id',
				{ productionSiteId: 101 }
			)
		);

		expect( state.states[ 101 ] ).toEqual( activeState );
	} );

	it( 'records completed environment sync state from polling', () => {
		const state = stagingSyncReducer(
			undefined,
			fetchStagingSiteSyncState.fulfilled(
				{
					productionSiteId: 101,
					stagingSiteId: 202,
					status: 'completed',
					direction: 'pull',
					completedAt: '2026-05-14T12:00:00+00:00',
				},
				'request-id',
				{ productionSiteId: 101 }
			)
		);

		expect( state.states[ 101 ] ).toMatchObject( {
			productionSiteId: 101,
			stagingSiteId: 202,
			status: 'completed',
			direction: 'pull',
			completedAt: '2026-05-14T12:00:00+00:00',
		} );
	} );

	it( 'posts production to staging sync requests to the staging endpoint', async () => {
		const post = vi.fn().mockResolvedValue( { success: true } );
		mockGetWpcomClient.mockReturnValue( {
			req: { post },
		} );
		const store = configureStore( {
			reducer: stagingSyncReducer,
		} );
		const productionSite = createSyncSite();
		const stagingSite = createSyncSite( {
			id: 202,
			isStaging: true,
			productionSiteId: 101,
		} );

		await store.dispatch(
			startStagingSiteSync( {
				productionSite,
				stagingSite,
				direction: 'push',
				options: [ 'themes', 'plugins' ],
			} )
		);

		expect( post ).toHaveBeenCalledWith( {
			apiNamespace: 'wpcom/v2',
			path: '/sites/101/staging-site/push-to-staging/202',
			body: {
				options: [ 'themes', 'plugins' ],
			},
		} );
	} );

	it( 'fetches production-scoped staging sync state', async () => {
		const get = vi.fn().mockResolvedValue( {
			status: 'completed',
			staging_blog_id: 202,
			production_blog_id: 101,
			direction: 'pull',
			options: { types: 'themes,plugins' },
		} );
		mockGetWpcomClient.mockReturnValue( {
			req: { get },
		} );
		const store = configureStore( {
			reducer: stagingSyncReducer,
		} );

		await store.dispatch( fetchStagingSiteSyncState( { productionSiteId: 101 } ) );

		expect( get ).toHaveBeenCalledWith( {
			apiNamespace: 'wpcom/v2',
			path: '/sites/101/staging-site/sync-state',
		} );
		expect( store.getState().states[ 101 ] ).toMatchObject( {
			status: 'completed',
			stagingSiteId: 202,
			direction: 'pull',
			options: [ 'themes', 'plugins' ],
		} );
	} );

	it( 'preserves WooCommerce database sync errors for confirm-and-retry handling', async () => {
		const error = {
			code: 'rest_sqls_option_not_supported',
			message: 'WooCommerce database sync requires confirmation.',
			status: 422,
		};
		const post = vi.fn().mockRejectedValue( error );
		mockGetWpcomClient.mockReturnValue( {
			req: { post },
		} );
		const store = configureStore( {
			reducer: stagingSyncReducer,
		} );
		const productionSite = createSyncSite();
		const stagingSite = createSyncSite( {
			id: 202,
			isStaging: true,
			productionSiteId: 101,
		} );

		const result = await store.dispatch(
			startStagingSiteSync( {
				productionSite,
				stagingSite,
				direction: 'pull',
				options: [ 'sqls' ],
			} )
		);

		expect( startStagingSiteSync.rejected.match( result ) ).toBe( true );
		expect( result.payload ).toMatchObject( {
			code: 'rest_sqls_option_not_supported',
			status: 422,
		} );
	} );
} );
