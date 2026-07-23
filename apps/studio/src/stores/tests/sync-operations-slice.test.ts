import { vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import {
	syncOperationsActions,
	syncOperationsSelectors,
	syncOperationsThunks,
	getPullStatesProgressInfo,
} from 'src/stores/sync/sync-operations-slice';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import type { SyncSite } from '@studio/common/types/sync';
import type { WPCOM } from 'wpcom/types';

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn().mockReturnValue( {
		showErrorMessageBox: vi.fn(),
		showNotification: vi.fn(),
		fetchSnapshots: vi.fn().mockResolvedValue( [] ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		updateConnectedWpcomSites: vi.fn(),
		cancelSyncOperation: vi.fn(),
	} ),
} ) );

const mockShowErrorMessageBox = vi.mocked( getIpcApi )().showErrorMessageBox as ReturnType<
	typeof vi.fn
>;

const selectedSite = { id: 'local-site-1', name: 'My Local Site' } as SiteDetails;
const connectedSite = {
	id: 256266481,
	localSiteId: 'local-site-1',
	name: 'My Remote Site',
	url: 'https://example.com',
} as SyncSite;

function createMockClient( postResponse?: unknown ) {
	return {
		req: {
			post: vi.fn().mockResolvedValue( postResponse ),
			get: vi.fn(),
		},
	} as unknown as WPCOM;
}

store.replaceReducer( testReducer );

describe( 'syncOperations pull thunks', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		store.dispatch( testActions.resetState() );
	} );

	describe( 'pullSite', () => {
		it( 'stores the backup ID and fulfills when the server returns one', async () => {
			const client = createMockClient( { success: true, backup_id: 12345 } );

			const result = await store.dispatch(
				syncOperationsThunks.pullSite( {
					client,
					connectedSite,
					selectedSite,
					options: { optionsToSync: [ 'all' ] },
				} )
			);

			expect( result.type ).toBe( 'syncOperations/pullSite/fulfilled' );
			const pullState = syncOperationsSelectors.selectPullState(
				selectedSite.id,
				connectedSite.id
			)( store.getState() );
			expect( pullState?.backupId ).toBe( 12345 );
		} );

		it( 'rejects with a "backup already in progress" error when the server responds 409 backup_already_in_progress', async () => {
			const client = createMockClient();
			( client.req.post as ReturnType< typeof vi.fn > ).mockRejectedValue( {
				error: 'backup_already_in_progress',
				message: 'A backup is already in progress for this site.',
				statusCode: 409,
			} );

			const result = await store.dispatch(
				syncOperationsThunks.pullSite( {
					client,
					connectedSite,
					selectedSite,
					options: { optionsToSync: [ 'all' ] },
				} )
			);

			expect( result.type ).toBe( 'syncOperations/pullSite/rejected' );
			expect( ( result.payload as { message: string } ).message ).toMatch(
				/backup is already in progress/i
			);

			const pullState = syncOperationsSelectors.selectPullState(
				selectedSite.id,
				connectedSite.id
			)( store.getState() );
			expect( pullState?.status.key ).toBe( 'failed' );
			expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					message: expect.stringMatching( /backup is already in progress/i ),
				} )
			);
		} );

		it( 'rejects with a "backup already in progress" error when the server dedupes the request with backup_id 0', async () => {
			const client = createMockClient( { success: true, backup_id: 0 } );

			const result = await store.dispatch(
				syncOperationsThunks.pullSite( {
					client,
					connectedSite,
					selectedSite,
					options: { optionsToSync: [ 'all' ] },
				} )
			);

			expect( result.type ).toBe( 'syncOperations/pullSite/rejected' );
			expect( ( result.payload as { message: string } ).message ).toMatch(
				/backup is already in progress/i
			);

			const pullState = syncOperationsSelectors.selectPullState(
				selectedSite.id,
				connectedSite.id
			)( store.getState() );
			expect( pullState?.status.key ).toBe( 'failed' );
			expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					message: expect.stringMatching( /backup is already in progress/i ),
				} )
			);
		} );
	} );

	describe( 'pollPullBackup', () => {
		it( 'rejects and marks the pull as failed when the state has no backup ID', async () => {
			const client = createMockClient();
			store.dispatch(
				syncOperationsActions.updatePullState( {
					selectedSiteId: selectedSite.id,
					remoteSiteId: connectedSite.id,
					state: {
						backupId: null,
						status: getPullStatesProgressInfo()[ 'in-progress' ],
						downloadUrl: null,
						remoteSiteUrl: connectedSite.url,
						selectedSite,
					},
				} )
			);

			const result = await store.dispatch(
				syncOperationsThunks.pollPullBackup( {
					client,
					selectedSiteId: selectedSite.id,
					remoteSiteId: connectedSite.id,
					signal: new AbortController().signal,
				} )
			);

			expect( result.type ).toBe( 'syncOperations/pollPullBackup/rejected' );
			expect( client.req.get ).not.toHaveBeenCalled();

			const pullState = syncOperationsSelectors.selectPullState(
				selectedSite.id,
				connectedSite.id
			)( store.getState() );
			expect( pullState?.status.key ).toBe( 'failed' );
			expect( mockShowErrorMessageBox ).toHaveBeenCalled();
		} );
	} );
} );
