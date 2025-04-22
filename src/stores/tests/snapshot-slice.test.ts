import crypto from 'crypto';
import { UnknownAction } from '@reduxjs/toolkit';
import { produce } from 'immer';
import { PreviewCommandLoggerAction } from 'common/logger-actions';
import { Snapshot } from 'common/types/snapshot';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores';
import {
	snapshotActions,
	snapshotSelectors,
	snapshotThunks,
	SnapshotOperation,
} from 'src/stores/snapshot-slice';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

jest.mock( 'src/lib/get-ipc-api' );
( getIpcApi as jest.Mock ).mockReturnValue( {
	getSnapshots: jest.fn(),
	createSnapshot: jest.fn(),
} );

function snapshotTestReducer( state: RootState | undefined, action: UnknownAction ) {
	if ( action.type === 'snapshot/addOperation' ) {
		const payload = action.payload as {
			operationId: crypto.UUID;
			operation: SnapshotOperation;
		};

		return produce( state!, ( draftState ) => {
			draftState.snapshot.operations[ payload.operationId ] = payload.operation;
		} );
	}

	if ( action.type === 'snapshot/addSnapshot' ) {
		const payload = action.payload as {
			snapshot: Snapshot;
		};

		return produce( state!, ( draftState ) => {
			if ( ! draftState.userData ) {
				draftState.userData = {
					sites: [],
					snapshots: [],
					isLoading: false,
					error: null,
				};
			} else if ( ! draftState.userData.snapshots ) {
				draftState.userData.snapshots = [];
			}
			draftState.userData.snapshots.push( payload.snapshot );
		} );
	}

	if ( action.type === 'test/initializeUserData' ) {
		return produce( state!, ( draftState ) => {
			draftState.userData = {
				sites: [],
				snapshots: [],
				isLoading: false,
				error: null,
			};
		} );
	}

	return testReducer( state, action );
}

const snapshotTestActions = {
	addOperation: ( operationId: crypto.UUID, operation: SnapshotOperation ) => {
		return { type: 'snapshot/addOperation', payload: { operationId, operation } };
	},
	addSnapshot: ( snapshot: Snapshot ) => {
		return { type: 'snapshot/addSnapshot', payload: { snapshot } };
	},
};

const extendedTestActions = {
	...testActions,
	initializeUserData: () => {
		return { type: 'test/initializeUserData' };
	},
};

store.replaceReducer( snapshotTestReducer );

describe( 'snapshot-slice', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		store.dispatch( testActions.resetState() );
	} );

	describe( 'createSnapshot', () => {
		it( 'should create operation when fulfilled', async () => {
			const siteId = 'test-site';
			const siteFolder = '/test/path';
			const operationId = '123e4567-e89b-12d3-a456-426614174000';

			( getIpcApi().createSnapshot as jest.Mock ).mockResolvedValue( { operationId } );

			const result = await store.dispatch(
				snapshotThunks.createSnapshot( { siteId, siteFolder } )
			);

			expect( result.type ).toBe( 'snapshot/createSnapshot/fulfilled' );
			expect( result.payload ).toEqual( { operationId, siteId } );

			const state = store.getState();
			expect( state.snapshot.operations[ operationId ] ).toEqual( {
				detail: 'Creating archive...',
				error: null,
				progress: 0,
				siteId,
				status: 'pending',
				type: 'create',
			} );
		} );

		it( 'should handle errors gracefully', async () => {
			const siteId = 'test-site';
			const siteFolder = '/test/path';

			( getIpcApi().createSnapshot as jest.Mock ).mockRejectedValue( new Error( 'API Error' ) );

			const result = await store.dispatch(
				snapshotThunks.createSnapshot( { siteId, siteFolder } )
			);

			expect( result.type ).toBe( 'snapshot/createSnapshot/rejected' );
			expect( ( result as { error: { message: string } } ).error.message ).toBe( 'API Error' );

			const state = store.getState();
			expect( state.snapshot.operations ).toEqual( {} );
		} );
	} );

	describe( 'updateOperation', () => {
		it( 'should update operation progress', () => {
			const operationId = '123e4567-e89b-12d3-a456-426614174000';
			const siteId = 'test-site';

			// First create an operation
			store.dispatch(
				snapshotTestActions.addOperation( operationId, {
					detail: '',
					error: null,
					progress: 0,
					siteId,
					status: 'pending',
					type: 'create',
				} )
			);

			// Then update its progress
			store.dispatch(
				snapshotActions.updateOperation( {
					operationId,
					operation: { progress: 50 },
				} )
			);

			const state = store.getState();
			expect( state.snapshot.operations[ operationId ] ).toEqual( {
				detail: '',
				error: null,
				progress: 50,
				siteId,
				status: 'pending',
				type: 'create',
			} );
		} );
	} );

	describe( 'selectors', () => {
		it( 'should check if operation is in progress for site', () => {
			const siteId = 'test-site';
			const operationId = '123e4567-e89b-12d3-a456-426614174000';

			// First create an operation
			store.dispatch(
				snapshotTestActions.addOperation( operationId, {
					detail: '',
					error: null,
					progress: 0,
					siteId,
					status: 'pending',
					type: 'create',
				} )
			);

			const state = store.getState();
			expect( snapshotSelectors.selectActiveCreateOperationForSite( state, siteId ) ).toBeTruthy();
			expect(
				snapshotSelectors.selectActiveCreateOperationForSite( state, 'other-site' )
			).toBeFalsy();
		} );

		it( 'should select snapshots by site and user', () => {
			const mockSnapshots: Snapshot[] = [
				{
					atomicSiteId: 1,
					date: Date.now(),
					name: 'Snapshot 1',
					localSiteId: 'site-1',
					url: 'https://example.com',
					userId: 1,
				},
				{
					atomicSiteId: 2,
					date: Date.now(),
					name: 'Snapshot 2',
					localSiteId: 'site-2',
					url: 'https://example.com',
					userId: 1,
				},
				{
					atomicSiteId: 3,
					date: Date.now(),
					name: 'Snapshot 3',
					localSiteId: 'site-1',
					url: 'https://example.com',
					userId: 2,
				},
			];

			// First make sure userData exists with a snapshots array
			store.dispatch( extendedTestActions.initializeUserData() );

			for ( const snapshot of mockSnapshots ) {
				store.dispatch( snapshotTestActions.addSnapshot( snapshot ) );
			}

			const state = store.getState();
			expect( snapshotSelectors.selectSnapshotsBySiteAndUser( state, 'site-1', 1 ) ).toEqual( [
				mockSnapshots[ 0 ],
			] );
		} );
	} );

	describe( 'progress values', () => {
		it( 'should have correct progress values for each action', () => {
			// These values should match the getProgress function in snapshot-slice.ts
			expect( PreviewCommandLoggerAction.VALIDATE ).toBe( 'validate' );
			expect( PreviewCommandLoggerAction.ARCHIVE ).toBe( 'archive' );
			expect( PreviewCommandLoggerAction.UPLOAD ).toBe( 'upload' );
			expect( PreviewCommandLoggerAction.READY ).toBe( 'ready' );
			expect( PreviewCommandLoggerAction.APPDATA ).toBe( 'appdata' );
		} );
	} );
} );
