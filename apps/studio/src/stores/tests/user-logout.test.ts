import { vi } from 'vitest';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { store } from 'src/stores';
import {
	syncOperationsActions,
	getPullStatesProgressInfo,
	getPushStatesProgressInfo,
} from 'src/stores/sync/sync-operations-slice';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import { userLogout } from 'src/stores/user-actions';

vi.mock( 'src/lib/get-ipc-api' );

store.replaceReducer( testReducer );

describe( 'userLogout action', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		store.dispatch( testActions.resetState() );
	} );

	it( 'should clear pull states on logout', () => {
		const selectedSiteId = 'site-1';
		const remoteSiteId = 100;

		store.dispatch(
			syncOperationsActions.updatePullState( {
				selectedSiteId,
				remoteSiteId,
				state: {
					backupId: 123,
					status: getPullStatesProgressInfo()[ 'in-progress' ],
					downloadUrl: null,
					remoteSiteUrl: 'https://example.com',
					selectedSite: { id: selectedSiteId, name: 'Test' } as SiteDetails,
				},
			} )
		);

		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		expect( store.getState().syncOperations.pullStates[ stateId ] ).toBeDefined();

		store.dispatch( userLogout() );

		expect( store.getState().syncOperations.pullStates ).toEqual( {} );
	} );

	it( 'should clear push states on logout', () => {
		const selectedSiteId = 'site-1';
		const remoteSiteId = 200;

		store.dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId,
				remoteSiteId,
				state: {
					status: getPushStatesProgressInfo().uploading,
					selectedSite: { id: selectedSiteId, name: 'Test' } as SiteDetails,
					remoteSiteUrl: 'https://example.com',
				},
			} )
		);

		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		expect( store.getState().syncOperations.pushStates[ stateId ] ).toBeDefined();

		store.dispatch( userLogout() );

		expect( store.getState().syncOperations.pushStates ).toEqual( {} );
	} );
} );
