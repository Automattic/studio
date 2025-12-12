import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { __ } from '@wordpress/i18n';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { SyncBackupState, PullStates } from 'src/hooks/sync-sites/use-sync-pull';
import type { SyncPushState, PushStates } from 'src/hooks/sync-sites/use-sync-push';
import type {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import type { AppDispatch, RootState } from 'src/stores';

interface SyncOperationsState {
	pullStates: PullStates;
	pushStates: PushStates;
}

const initialState: SyncOperationsState = {
	pullStates: {},
	pushStates: {},
};

type UpdatePullStatePayload = {
	selectedSiteId: string;
	remoteSiteId: number;
	state: Partial< SyncBackupState >;
};

type UpdatePushStatePayload = {
	selectedSiteId: string;
	remoteSiteId: number;
	state: Partial< SyncPushState >;
};

type ClearStatePayload = {
	selectedSiteId: string;
	remoteSiteId: number;
};

const syncOperationsSlice = createSlice( {
	name: 'syncOperations',
	initialState,
	reducers: {
		updatePullState: ( state, action: PayloadAction< UpdatePullStatePayload > ) => {
			const { selectedSiteId, remoteSiteId, state: updateState } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );

			state.pullStates[ stateId ] = {
				...state.pullStates[ stateId ],
				...updateState,
			} as SyncBackupState;
		},

		clearPullState: ( state, action: PayloadAction< ClearStatePayload > ) => {
			const { selectedSiteId, remoteSiteId } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			delete state.pullStates[ stateId ];
		},

		updatePushState: ( state, action: PayloadAction< UpdatePushStatePayload > ) => {
			const { selectedSiteId, remoteSiteId, state: updateState } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );

			state.pushStates[ stateId ] = {
				...state.pushStates[ stateId ],
				...updateState,
			} as SyncPushState;
		},

		clearPushState: ( state, action: PayloadAction< ClearStatePayload > ) => {
			const { selectedSiteId, remoteSiteId } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			delete state.pushStates[ stateId ];
		},

		setPullStates: ( state, action: PayloadAction< PullStates > ) => {
			state.pullStates = action.payload;
		},

		setPushStates: ( state, action: PayloadAction< PushStates > ) => {
			state.pushStates = action.payload;
		},

		clearAllStates: ( state ) => {
			state.pullStates = {};
			state.pushStates = {};
		},
	},
} );

export const syncOperationsActions = syncOperationsSlice.actions;
export const syncOperationsReducer = syncOperationsSlice.reducer;

// Create typed async thunk helper
const createTypedAsyncThunk = createAsyncThunk.withTypes< {
	state: RootState;
	dispatch: AppDispatch;
} >();

// Thunks for clear operations
export const clearPushStateThunk = createTypedAsyncThunk(
	'syncOperations/clearPushState',
	async ( { selectedSiteId, remoteSiteId }: ClearStatePayload ) => {
		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		getIpcApi().clearSyncOperation( stateId );
		return { selectedSiteId, remoteSiteId };
	}
);

export const clearPullStateThunk = createTypedAsyncThunk(
	'syncOperations/clearPullState',
	async ( { selectedSiteId, remoteSiteId }: ClearStatePayload ) => {
		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		getIpcApi().clearSyncOperation( stateId );
		return { selectedSiteId, remoteSiteId };
	}
);

// Thunks for cancel operations
type CancelPushPayload = {
	selectedSiteId: string;
	remoteSiteId: number;
	cancelledStatus: PushStateProgressInfo;
};

type CancelPullPayload = {
	selectedSiteId: string;
	remoteSiteId: number;
	cancelledStatus: PullStateProgressInfo;
};

export const cancelPushThunk = createTypedAsyncThunk(
	'syncOperations/cancelPush',
	async ( { selectedSiteId, remoteSiteId, cancelledStatus }: CancelPushPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );
		getIpcApi().cancelSyncOperation( operationId );

		dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId,
				remoteSiteId,
				state: { status: cancelledStatus },
			} )
		);

		getIpcApi().showNotification( {
			title: __( 'Push cancelled' ),
			body: __( 'The push operation has been cancelled.' ),
		} );
	}
);

export const cancelPullThunk = createTypedAsyncThunk(
	'syncOperations/cancelPull',
	async ( { selectedSiteId, remoteSiteId, cancelledStatus }: CancelPullPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );
		getIpcApi().cancelSyncOperation( operationId );

		dispatch(
			syncOperationsActions.updatePullState( {
				selectedSiteId,
				remoteSiteId,
				state: { status: cancelledStatus },
			} )
		);

		getIpcApi()
			.removeSyncBackup( remoteSiteId )
			.catch( () => {
				// Ignore errors if file doesn't exist
			} );

		getIpcApi().showNotification( {
			title: __( 'Pull cancelled' ),
			body: __( 'The pull operation has been cancelled.' ),
		} );
	}
);

// Export thunks object for convenience
export const syncOperationsThunks = {
	clearPushState: clearPushStateThunk,
	clearPullState: clearPullStateThunk,
	cancelPush: cancelPushThunk,
	cancelPull: cancelPullThunk,
};

// Helper functions for checking state keys (matching useSyncStatesProgressInfo logic)
const isKeyPulling = ( key: string | undefined ): boolean => {
	if ( ! key ) {
		return false;
	}
	const pullingStateKeys = [ 'in-progress', 'downloading', 'importing' ];
	return pullingStateKeys.includes( key );
};

const isKeyPushing = ( key: string | undefined ): boolean => {
	if ( ! key ) {
		return false;
	}
	const pushingStateKeys = [
		'creatingBackup',
		'uploading',
		'creatingRemoteBackup',
		'applyingChanges',
		'finishing',
	];
	return pushingStateKeys.includes( key );
};

export const syncOperationsSelectors = {
	selectPullStates: ( state: { syncOperations: SyncOperationsState } ) =>
		state.syncOperations.pullStates,
	selectPushStates: ( state: { syncOperations: SyncOperationsState } ) =>
		state.syncOperations.pushStates,
	selectPullState:
		( selectedSiteId: string, remoteSiteId: number ) =>
		( state: { syncOperations: SyncOperationsState } ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return state.syncOperations.pullStates[ stateId ];
		},
	selectPushState:
		( selectedSiteId: string, remoteSiteId: number ) =>
		( state: { syncOperations: SyncOperationsState } ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return state.syncOperations.pushStates[ stateId ];
		},
	selectIsAnySitePulling: ( state: { syncOperations: SyncOperationsState } ): boolean => {
		return Object.values( state.syncOperations.pullStates ).some( ( pullState ) =>
			isKeyPulling( pullState.status.key )
		);
	},
	selectIsSiteIdPulling:
		( selectedSiteId: string, remoteSiteId?: number ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return Object.values( state.syncOperations.pullStates ).some( ( pullState ) => {
				if ( ! pullState.selectedSite ) {
					return false;
				}
				if ( pullState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined ) {
					return isKeyPulling( pullState.status.key ) && pullState.remoteSiteId === remoteSiteId;
				}
				return isKeyPulling( pullState.status.key );
			} );
		},
	selectIsAnySitePushing: ( state: { syncOperations: SyncOperationsState } ): boolean => {
		return Object.values( state.syncOperations.pushStates ).some( ( pushState ) =>
			isKeyPushing( pushState.status.key )
		);
	},
	selectIsSiteIdPushing:
		( selectedSiteId: string, remoteSiteId?: number ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return Object.values( state.syncOperations.pushStates ).some( ( pushState ) => {
				if ( ! pushState.selectedSite ) {
					return false;
				}
				if ( pushState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined ) {
					return isKeyPushing( pushState.status.key ) && pushState.remoteSiteId === remoteSiteId;
				}
				return isKeyPushing( pushState.status.key );
			} );
		},
};
