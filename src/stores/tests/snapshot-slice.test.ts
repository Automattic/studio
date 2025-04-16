import crypto from 'crypto';
import { UnknownAction } from '@reduxjs/toolkit';
import { produce } from 'immer';
import { CreateLoggerAction } from 'cli/commands/preview/logger-actions';
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
			draftState.snapshot.snapshots.push( payload.snapshot );
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

store.replaceReducer( snapshotTestReducer );

describe( 'snapshot-slice', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		store.dispatch( testActions.resetState() );
	} );

	describe( 'getSnapshots', () => {
		it( 'should update snapshots when fulfilled', async () => {
			const mockSnapshots = [
				{ id: '1', localSiteId: 'site-1', userId: 1 },
				{ id: '2', localSiteId: 'site-2', userId: 1 },
			];

			( getIpcApi().getSnapshots as jest.Mock ).mockResolvedValue( mockSnapshots );

			const result = await store.dispatch( snapshotThunks.getSnapshots() );

			expect( result.type ).toBe( 'snapshot/getSnapshots/fulfilled' );
			expect( result.payload ).toEqual( mockSnapshots );

			const state = store.getState();
			expect( state.snapshot.snapshots ).toEqual( mockSnapshots );
		} );

		it( 'should handle errors gracefully', async () => {
			( getIpcApi().getSnapshots as jest.Mock ).mockRejectedValue( new Error( 'API Error' ) );

			const result = await store.dispatch( snapshotThunks.getSnapshots() );

			expect( result.type ).toBe( 'snapshot/getSnapshots/rejected' );
			expect( ( result as { error: { message: string } } ).error.message ).toBe( 'API Error' );

			const state = store.getState();
			expect( state.snapshot.snapshots ).toEqual( [] );
		} );
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
			expect( snapshotSelectors.isOperationInProgressForSite( state, siteId ) ).toBeTruthy();
			expect( snapshotSelectors.isOperationInProgressForSite( state, 'other-site' ) ).toBeFalsy();
		} );

		it( 'should select snapshots by site and user', () => {
			const mockSnapshots: Snapshot[] = [
				{
					atomicSiteId: 1,
					date: Date.now(),
					localSiteId: 'site-1',
					url: 'https://example.com',
					userId: 1,
				},
				{
					atomicSiteId: 2,
					date: Date.now(),
					localSiteId: 'site-2',
					url: 'https://example.com',
					userId: 1,
				},
				{
					atomicSiteId: 3,
					date: Date.now(),
					localSiteId: 'site-1',
					url: 'https://example.com',
					userId: 2,
				},
			];

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
			expect( CreateLoggerAction.VALIDATE ).toBe( 'validate' );
			expect( CreateLoggerAction.ARCHIVE ).toBe( 'archive' );
			expect( CreateLoggerAction.UPLOAD ).toBe( 'upload' );
			expect( CreateLoggerAction.READY ).toBe( 'ready' );
			expect( CreateLoggerAction.APPDATA ).toBe( 'appdata' );
		} );
	} );
} );
