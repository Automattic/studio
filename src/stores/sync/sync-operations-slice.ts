import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { WPCOM } from 'wpcom/types';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from 'src/constants';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type {
	PullSiteOptions,
	SyncBackupState,
	PullStates,
} from 'src/hooks/sync-sites/use-sync-pull';
import type { SyncPushState, PushStates } from 'src/hooks/sync-sites/use-sync-push';
import type {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import type { SyncSite } from 'src/modules/sync/types';
import type { AppDispatch, RootState } from 'src/stores';
import type { SyncOption } from 'src/types';

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

// Helper functions for push operations
const isKeyCancelled = ( key: string | undefined ): boolean => {
	return key === 'cancelled';
};

const isKeyFailed = ( key: string | undefined ): boolean => {
	return key === 'failed';
};

const isKeyFinished = ( key: string | undefined ): boolean => {
	return key === 'finished';
};

const getErrorFromResponse = ( error: unknown ): string => {
	if (
		typeof error === 'object' &&
		error !== null &&
		'error' in error &&
		typeof ( error as { error: unknown } ).error === 'string'
	) {
		return ( error as { error: string } ).error;
	}
	return __( 'Studio was unable to connect to WordPress.com. Please try again.' );
};

// Helper to update push state and sync with IPC (matching updatePushState logic)
const updatePushStateWithIpc = (
	dispatch: AppDispatch,
	selectedSiteId: string,
	remoteSiteId: number,
	state: Partial< SyncPushState >,
	isKeyFailedFn: ( key: string | undefined ) => boolean,
	isKeyFinishedFn: ( key: string | undefined ) => boolean
) => {
	const stateId = generateStateId( selectedSiteId, remoteSiteId );
	const statusKey = state.status?.key;

	dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId,
			remoteSiteId,
			state,
		} )
	);

	if ( isKeyFailedFn( statusKey ) || isKeyFinishedFn( statusKey ) || isKeyCancelled( statusKey ) ) {
		getIpcApi().clearSyncOperation( stateId );
	} else if ( state.status ) {
		getIpcApi().addSyncOperation( stateId, state.status );
	}
};

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

// Thunk for push operation
type PushSitePayload = {
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
	options?: {
		optionsToSync?: SyncOption[];
		specificSelectionPaths?: string[];
	};
	pushStatesProgressInfo: Record< PushStateProgressInfo[ 'key' ], PushStateProgressInfo >;
};

type PushSiteResult = {
	shouldStartPolling: boolean;
	remoteSiteId: number;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
};

export const pushSiteThunk = createTypedAsyncThunk< PushSiteResult, PushSitePayload >(
	'syncOperations/pushSite',
	async (
		{ connectedSite, selectedSite, options, pushStatesProgressInfo },
		{ dispatch, getState }
	) => {
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;
		const operationId = generateStateId( selectedSite.id, remoteSiteId );

		// Clear existing state
		dispatch(
			syncOperationsActions.clearPushState( { selectedSiteId: selectedSite.id, remoteSiteId } )
		);
		void dispatch(
			syncOperationsThunks.clearPushState( { selectedSiteId: selectedSite.id, remoteSiteId } )
		);

		// Initialize push state
		updatePushStateWithIpc(
			dispatch,
			selectedSite.id,
			remoteSiteId,
			{
				remoteSiteId,
				status: pushStatesProgressInfo.creatingBackup,
				selectedSite,
				remoteSiteUrl,
			},
			isKeyFailed,
			isKeyFinished
		);

		let archivePath: string, archiveSizeInBytes: number;

		try {
			const result = await getIpcApi().exportSiteForPush( selectedSite.id, operationId, {
				optionsToSync: options?.optionsToSync,
				specificSelectionPaths: options?.specificSelectionPaths,
			} );
			( { archivePath, archiveSizeInBytes } = result );
		} catch ( error ) {
			if ( error instanceof Error && error.message === 'Export aborted' ) {
				updatePushStateWithIpc(
					dispatch,
					selectedSite.id,
					remoteSiteId,
					{ status: pushStatesProgressInfo.cancelled },
					isKeyFailed,
					isKeyFinished
				);
				throw error; // Signal cancellation
			}

			Sentry.captureException( error );
			updatePushStateWithIpc(
				dispatch,
				selectedSite.id,
				remoteSiteId,
				{ status: pushStatesProgressInfo.failed },
				isKeyFailed,
				isKeyFinished
			);
			getIpcApi().showErrorMessageBox( {
				title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
				message: __(
					'An error occurred while pushing the site. If this problem persists, please contact support.'
				),
				error,
				showOpenLogs: true,
			} );
			throw error;
		}

		// Check file size
		if ( archiveSizeInBytes > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			updatePushStateWithIpc(
				dispatch,
				selectedSite.id,
				remoteSiteId,
				{ status: pushStatesProgressInfo.failed },
				isKeyFailed,
				isKeyFinished
			);
			getIpcApi().showErrorMessageBox( {
				title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
				message: __(
					'The site is too large to push. Please reduce the size of the site and try again.'
				),
			} );
			await getIpcApi().removeExportedSiteTmpFile( archivePath );
			throw new Error( 'Site too large' );
		}

		// Check if cancelled before upload
		const state = getState();
		const currentPushState = syncOperationsSelectors.selectPushState(
			selectedSite.id,
			remoteSiteId
		)( state );
		if ( ! currentPushState || isKeyCancelled( currentPushState.status.key ) ) {
			await getIpcApi().removeExportedSiteTmpFile( archivePath );
			throw new Error( 'Push cancelled' );
		}

		// Update to uploading
		updatePushStateWithIpc(
			dispatch,
			selectedSite.id,
			remoteSiteId,
			{ status: pushStatesProgressInfo.uploading },
			isKeyFailed,
			isKeyFinished
		);

		try {
			const response = await getIpcApi().pushArchive(
				remoteSiteId,
				archivePath,
				options?.optionsToSync,
				options?.specificSelectionPaths
			);

			// Check if cancelled after upload
			const stateAfterUpload = getState();
			const pushStateAfterUpload = syncOperationsSelectors.selectPushState(
				selectedSite.id,
				remoteSiteId
			)( stateAfterUpload );

			if ( isKeyCancelled( pushStateAfterUpload?.status.key ) ) {
				await getIpcApi().removeExportedSiteTmpFile( archivePath );
				throw new Error( 'Push cancelled' );
			}

			if ( response.success ) {
				updatePushStateWithIpc(
					dispatch,
					selectedSite.id,
					remoteSiteId,
					{
						status: pushStatesProgressInfo.creatingRemoteBackup,
						selectedSite,
						remoteSiteUrl,
					},
					isKeyFailed,
					isKeyFinished
				);

				// Return info needed for polling
				return {
					shouldStartPolling: true,
					remoteSiteId,
					selectedSite,
					remoteSiteUrl,
				};
			} else {
				throw response;
			}
		} catch ( error ) {
			Sentry.captureException( error );
			updatePushStateWithIpc(
				dispatch,
				selectedSite.id,
				remoteSiteId,
				{ status: pushStatesProgressInfo.failed },
				isKeyFailed,
				isKeyFinished
			);
			getIpcApi().showErrorMessageBox( {
				title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
				message: getErrorFromResponse( error ),
			} );
			throw error;
		} finally {
			await getIpcApi().removeExportedSiteTmpFile( archivePath );
		}
	}
);

// Thunk for pull operation
type PullSitePayload = {
	client: WPCOM;
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
	options: {
		optionsToSync: SyncOption[];
		include_path_list?: string[];
	};
	pullStatesProgressInfo: Record< PullStateProgressInfo[ 'key' ], PullStateProgressInfo >;
};

type PullSiteResult = {
	backupId: string;
	remoteSiteId: number;
};

export const pullSiteThunk = createTypedAsyncThunk< PullSiteResult, PullSitePayload >(
	'syncOperations/pullSite',
	async (
		{ client, connectedSite, selectedSite, options, pullStatesProgressInfo },
		{ dispatch }
	) => {
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;

		// Clear existing state
		dispatch(
			syncOperationsActions.clearPullState( { selectedSiteId: selectedSite.id, remoteSiteId } )
		);
		void dispatch(
			syncOperationsThunks.clearPullState( { selectedSiteId: selectedSite.id, remoteSiteId } )
		);

		// Initialize pull state
		dispatch(
			syncOperationsActions.updatePullState( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				state: {
					backupId: null,
					status: pullStatesProgressInfo[ 'in-progress' ],
					downloadUrl: null,
					remoteSiteId,
					remoteSiteUrl,
					selectedSite,
				},
			} )
		);

		// Add sync operation for tracking
		const stateId = generateStateId( selectedSite.id, remoteSiteId );
		getIpcApi().addSyncOperation( stateId );

		try {
			// Initializing backup on remote
			const requestBody: {
				options: SyncOption[];
				include_path_list?: string[];
			} = {
				options: options.optionsToSync,
				include_path_list: options.include_path_list,
			};

			const response = await client.req.post< { success: boolean; backup_id: string } >( {
				path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
				apiNamespace: 'wpcom/v2',
				body: requestBody,
			} );

			if ( response.success ) {
				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId: selectedSite.id,
						remoteSiteId,
						state: {
							backupId: response.backup_id,
						},
					} )
				);

				return {
					backupId: response.backup_id,
					remoteSiteId,
				};
			} else {
				console.error( response );
				throw new Error( 'Pull request failed' );
			}
		} catch ( error ) {
			console.error( 'Pull request failed:', error );

			Sentry.captureException( error );
			dispatch(
				syncOperationsActions.updatePullState( {
					selectedSiteId: selectedSite.id,
					remoteSiteId,
					state: {
						status: pullStatesProgressInfo.failed,
					},
				} )
			);

			getIpcApi().showErrorMessageBox( {
				title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
				message: __( 'Studio was unable to connect to WordPress.com. Please try again.' ),
			} );

			throw error;
		}
	}
);

// Export thunks object for convenience
export const syncOperationsThunks = {
	clearPushState: clearPushStateThunk,
	clearPullState: clearPullStateThunk,
	cancelPush: cancelPushThunk,
	cancelPull: cancelPullThunk,
	pushSite: pushSiteThunk,
	pullSite: pullSiteThunk,
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
