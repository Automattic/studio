import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { WPCOM } from 'wpcom/types';
import { SYNC_PUSH_SIZE_LIMIT_BYTES, SYNC_PUSH_SIZE_LIMIT_GB } from 'src/constants';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getHostnameFromUrl } from 'src/lib/url-utils';
import { store } from 'src/stores';
import { connectedSitesApi } from 'src/stores/sync/connected-sites';
import type { SyncBackupState, PullStates } from 'src/hooks/sync-sites/use-sync-pull';
import type { SyncPushState, PushStates } from 'src/hooks/sync-sites/use-sync-push';
import type {
	ImportResponse,
	PullStateProgressInfo,
	PushStateProgressInfo,
	SyncBackupResponse,
} from 'src/hooks/use-sync-states-progress-info';
import type { SyncSite } from 'src/modules/sync/types';
import type { AppDispatch, RootState } from 'src/stores';
import type { SyncOption } from 'src/types';

// Factory functions for progress info (canonical definitions, also used by useSyncStatesProgressInfo hook)
export function getPushStatesProgressInfo(): Record<
	PushStateProgressInfo[ 'key' ],
	PushStateProgressInfo
> {
	return {
		creatingBackup: { key: 'creatingBackup', progress: 20, message: __( 'Creating backup…' ) },
		uploading: { key: 'uploading', progress: 40, message: __( 'Uploading site…' ) },
		uploadingPaused: { key: 'uploadingPaused', progress: 45, message: __( 'Uploading paused' ) },
		uploadingManuallyPaused: {
			key: 'uploadingManuallyPaused',
			progress: 45,
			message: __( 'Uploading paused' ),
		},
		creatingRemoteBackup: {
			key: 'creatingRemoteBackup',
			progress: 50,
			message: __( 'Backing up remote site…' ),
		},
		applyingChanges: { key: 'applyingChanges', progress: 60, message: __( 'Applying changes…' ) },
		finishing: { key: 'finishing', progress: 99, message: __( 'Almost there…' ) },
		finished: { key: 'finished', progress: 100, message: __( 'Push complete' ) },
		failed: { key: 'failed', progress: 100, message: __( 'Error pushing changes' ) },
		cancelled: { key: 'cancelled', progress: 0, message: __( 'Cancelled' ) },
	};
}

export function getPullStatesProgressInfo(): Record<
	PullStateProgressInfo[ 'key' ],
	PullStateProgressInfo
> {
	return {
		'in-progress': {
			key: 'in-progress',
			progress: 30,
			message: __( 'Initializing remote backup…' ),
		},
		downloading: { key: 'downloading', progress: 60, message: __( 'Downloading backup…' ) },
		importing: { key: 'importing', progress: 80, message: __( 'Importing backup…' ) },
		finished: { key: 'finished', progress: 100, message: __( 'Pull complete' ) },
		failed: { key: 'failed', progress: 100, message: __( 'Error pulling changes' ) },
		cancelled: { key: 'cancelled', progress: 0, message: __( 'Cancelled' ) },
	};
}

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
				remoteSiteId,
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
				remoteSiteId,
			} as SyncPushState;
		},

		clearPushState: ( state, action: PayloadAction< ClearStatePayload > ) => {
			const { selectedSiteId, remoteSiteId } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			delete state.pushStates[ stateId ];
		},
	},
	extraReducers: ( builder ) => {
		// Handle push thunk rejections (pushSiteThunk, pollPushProgressThunk)
		builder.addMatcher(
			( action ): action is PayloadAction< RejectedSyncPayload > =>
				[ 'syncOperations/pushSite/rejected', 'syncOperations/pollPushProgress/rejected' ].includes(
					action.type
				) && action.payload != null,
			( state, action ) => {
				const { selectedSiteId, remoteSiteId } = action.payload;
				const stateId = generateStateId( selectedSiteId, remoteSiteId );
				if ( state.pushStates[ stateId ] ) {
					state.pushStates[ stateId ].status = {
						key: 'failed',
						progress: 100,
						message: __( 'Error pushing changes' ),
					};
				}
			}
		);
		// Handle pull thunk rejections (pullSiteThunk, pollPullBackupThunk)
		builder.addMatcher(
			( action ): action is PayloadAction< RejectedSyncPayload > =>
				[ 'syncOperations/pullSite/rejected', 'syncOperations/pollPullBackup/rejected' ].includes(
					action.type
				) && action.payload != null,
			( state, action ) => {
				const { selectedSiteId, remoteSiteId } = action.payload;
				const stateId = generateStateId( selectedSiteId, remoteSiteId );
				if ( state.pullStates[ stateId ] ) {
					state.pullStates[ stateId ].status = {
						key: 'failed',
						progress: 100,
						message: __( 'Error pulling changes' ),
					};
				}
			}
		);
	},
} );

export const syncOperationsActions = syncOperationsSlice.actions;
export const syncOperationsReducer = syncOperationsSlice.reducer;

/**
 * Keep upload progress in sync with the renderer store.
 *
 * The main process emits upload progress via IPC while streaming the push backup
 * to WordPress.com (TUS). The UI expects `pushState.uploadProgress` to be updated
 * so it can render "Uploading site (%d%)…" and, optionally, a smoother progress
 * bar during the upload phase.
 */
const UPLOADING_BASE_PROGRESS = 40;
const CREATING_REMOTE_BACKUP_PROGRESS = 50;

function isUploadPhaseKey( key: SyncPushState[ 'status' ][ 'key' ] | undefined ) {
	return key === 'creatingBackup' || key === 'uploading' || key === 'uploadingPaused';
}

window.ipcListener.subscribe( 'sync-upload-progress', ( _event, payload ) => {
	const stateId = generateStateId( payload.selectedSiteId, payload.remoteSiteId );
	const existing = store.getState().syncOperations.pushStates[ stateId ];
	if ( ! existing || ! isUploadPhaseKey( existing.status?.key ) ) {
		return;
	}

	const uploadProgress = Math.max( 0, Math.min( 100, payload.progress ) );
	const uploadRange = CREATING_REMOTE_BACKUP_PROGRESS - UPLOADING_BASE_PROGRESS; // 10
	const overallProgress = UPLOADING_BASE_PROGRESS + ( uploadProgress / 100 ) * uploadRange;

	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				uploadProgress,
				status: {
					...existing.status,
					key: 'uploading',
					progress: overallProgress,
				},
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-paused', ( _event, payload ) => {
	const stateId = generateStateId( payload.selectedSiteId, payload.remoteSiteId );
	const existing = store.getState().syncOperations.pushStates[ stateId ];
	if ( ! existing || ! isUploadPhaseKey( existing.status?.key ) ) {
		return;
	}

	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: {
					...existing.status,
					key: 'uploadingPaused',
					progress: 45,
					message: __( 'Uploading paused' ),
				},
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-resumed', ( _event, payload ) => {
	const stateId = generateStateId( payload.selectedSiteId, payload.remoteSiteId );
	const existing = store.getState().syncOperations.pushStates[ stateId ];
	if ( ! existing || ! isUploadPhaseKey( existing.status?.key ) ) {
		return;
	}

	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: {
					...existing.status,
					key: 'uploading',
					message: __( 'Uploading site…' ),
				},
			},
		} )
	);
} );

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

// Payload type for thunk rejections handled by extraReducers
export type RejectedSyncPayload = {
	selectedSiteId: string;
	remoteSiteId: number;
	errorInfo?: {
		title: string;
		message: string;
		showOpenLogs?: boolean;
		error?: unknown;
	};
};

// Create typed async thunk helper
const createTypedAsyncThunk = createAsyncThunk.withTypes< {
	state: RootState;
	dispatch: AppDispatch;
	rejectValue: RejectedSyncPayload;
} >();

// Thunks for clear operations
export const clearPushStateThunk = createTypedAsyncThunk(
	'syncOperations/clearPushState',
	async ( { selectedSiteId, remoteSiteId }: ClearStatePayload, { dispatch } ) => {
		dispatch( syncOperationsActions.clearPushState( { selectedSiteId, remoteSiteId } ) );
		return { selectedSiteId, remoteSiteId };
	}
);

export const clearPullStateThunk = createTypedAsyncThunk(
	'syncOperations/clearPullState',
	async ( { selectedSiteId, remoteSiteId }: ClearStatePayload, { dispatch } ) => {
		dispatch( syncOperationsActions.clearPullState( { selectedSiteId, remoteSiteId } ) );
		return { selectedSiteId, remoteSiteId };
	}
);

// Thunks for cancel operations
type CancelPushPayload = {
	selectedSiteId: string;
	remoteSiteId: number;
};

type CancelPullPayload = {
	selectedSiteId: string;
	remoteSiteId: number;
};

export const cancelPushThunk = createTypedAsyncThunk(
	'syncOperations/cancelPush',
	async ( { selectedSiteId, remoteSiteId }: CancelPushPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );
		getIpcApi().cancelSyncOperation( operationId );

		dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId,
				remoteSiteId,
				state: { status: getPushStatesProgressInfo().cancelled },
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
	async ( { selectedSiteId, remoteSiteId }: CancelPullPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );
		getIpcApi().cancelSyncOperation( operationId );

		dispatch(
			syncOperationsActions.updatePullState( {
				selectedSiteId,
				remoteSiteId,
				state: { status: getPullStatesProgressInfo().cancelled },
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
};

type PushSiteResult = {
	shouldStartPolling: boolean;
	remoteSiteId: number;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
};

export const pushSiteThunk = createTypedAsyncThunk< PushSiteResult, PushSitePayload >(
	'syncOperations/pushSite',
	async ( { connectedSite, selectedSite, options }, { dispatch, getState, rejectWithValue } ) => {
		const pushStatesProgressInfo = getPushStatesProgressInfo();
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;
		const operationId = generateStateId( selectedSite.id, remoteSiteId );

		// Clear existing state
		void dispatch(
			syncOperationsThunks.clearPushState( { selectedSiteId: selectedSite.id, remoteSiteId } )
		);

		// Initialize push state
		dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				state: {
					status: pushStatesProgressInfo.creatingBackup,
					selectedSite,
					remoteSiteUrl,
				},
			} )
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
				dispatch(
					syncOperationsActions.updatePushState( {
						selectedSiteId: selectedSite.id,
						remoteSiteId,
						state: { status: pushStatesProgressInfo.cancelled },
					} )
				);
				throw error; // Signal cancellation
			}

			Sentry.captureException( error );
			return rejectWithValue( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				errorInfo: {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					),
					showOpenLogs: true,
					error,
				},
			} );
		}

		// Check file size
		if ( archiveSizeInBytes > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			await getIpcApi().removeExportedSiteTmpFile( archivePath );
			return rejectWithValue( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				errorInfo: {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'The site is too large to push. Please reduce the size of the site and try again.'
					),
				},
			} );
		}

		// Check if cancelled before upload
		const state = getState();
		const currentPushState = syncOperationsSelectors.selectPushState(
			selectedSite.id,
			remoteSiteId
		)( state );
		if (
			! currentPushState ||
			! currentPushState.status ||
			currentPushState.status.key === 'cancelled'
		) {
			await getIpcApi().removeExportedSiteTmpFile( archivePath );
			throw new Error( 'Push cancelled' );
		}

		// Update to uploading
		dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				state: { status: pushStatesProgressInfo.uploading },
			} )
		);

		try {
			const response = await getIpcApi().pushArchive(
				selectedSite.id,
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

			if ( pushStateAfterUpload?.status.key === 'cancelled' ) {
				throw new Error( 'Push cancelled' );
			}

			if ( response.success ) {
				dispatch(
					syncOperationsActions.updatePushState( {
						selectedSiteId: selectedSite.id,
						remoteSiteId,
						state: {
							status: pushStatesProgressInfo.creatingRemoteBackup,
							selectedSite,
							remoteSiteUrl,
						},
					} )
				);

				// Return info needed for polling
				return {
					shouldStartPolling: true,
					remoteSiteId,
					selectedSite,
					remoteSiteUrl,
				};
			} else {
				throw new Error( response.error );
			}
		} catch ( error ) {
			// Don't override cancelled state
			if ( error instanceof Error && error.message === 'Push cancelled' ) {
				throw error;
			}
			Sentry.captureException( error );
			return rejectWithValue( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				errorInfo: {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: getErrorFromResponse( error ),
				},
			} );
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
};

type PullSiteResult = {
	backupId: string;
	remoteSiteId: number;
};

export const pullSiteThunk = createTypedAsyncThunk< PullSiteResult, PullSitePayload >(
	'syncOperations/pullSite',
	async ( { client, connectedSite, selectedSite, options }, { dispatch, rejectWithValue } ) => {
		const pullStatesProgressInfo = getPullStatesProgressInfo();
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;

		// Clear existing state
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
					remoteSiteUrl,
					selectedSite,
				},
			} )
		);

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
			return rejectWithValue( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				errorInfo: {
					title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
					message: __( 'Studio was unable to connect to WordPress.com. Please try again.' ),
				},
			} );
		}
	}
);

// Thunk for polling push progress
type PollPushProgressPayload = {
	client: WPCOM;
	selectedSiteId: string;
	remoteSiteId: number;
};

export const pollPushProgressThunk = createTypedAsyncThunk(
	'syncOperations/pollPushProgress',
	async (
		{ client, selectedSiteId, remoteSiteId }: PollPushProgressPayload,
		{ dispatch, getState, rejectWithValue }
	) => {
		const pushStatesProgressInfo = getPushStatesProgressInfo();
		// condition guarantees currentPushState exists and is not cancelled
		const currentPushState = syncOperationsSelectors.selectPushState(
			selectedSiteId,
			remoteSiteId
		)( getState() )!;

		const response = await client.req.get< ImportResponse >(
			`/sites/${ remoteSiteId }/studio-app/sync/import`,
			{
				apiNamespace: 'wpcom/v2',
			}
		);

		if ( ! response.success ) {
			return rejectWithValue( {
				selectedSiteId,
				remoteSiteId,
				errorInfo: {
					title: sprintf( __( 'Error pushing to %s' ), currentPushState.selectedSite.name ),
					message: __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					),
				},
			} );
		}

		let status: PushStateProgressInfo;
		switch ( response.status ) {
			case 'finished':
				status = pushStatesProgressInfo.finished;
				// Update site timestamp
				void dispatch(
					connectedSitesApi.endpoints.updateSiteTimestamp.initiate( {
						siteId: remoteSiteId,
						localSiteId: selectedSiteId,
						type: 'push',
					} )
				);
				getIpcApi().showNotification( {
					title: currentPushState.selectedSite.name,
					body: sprintf(
						// translators: %s is the site url without the protocol.
						__( '%s has been updated' ),
						getHostnameFromUrl( currentPushState.remoteSiteUrl )
					),
				} );
				break;
			case 'failed': {
				console.error( 'Push import failed:', {
					remoteSiteId: currentPushState.remoteSiteId,
					error: response.error,
					error_data: response.error_data,
				} );
				// If the import fails due to a SQL import error, show a more specific message
				const restoreMessage = response.error_data?.vp_restore_message || '';
				const isSqlImportFailure = /importing sql dump/i.test( restoreMessage );
				const isImportTimedOut = response.error === 'Import timed out';
				let message: string;
				if ( isSqlImportFailure ) {
					message = __(
						'Database import failed on the remote site. Please review your database and try again or contact support and provide details from the logs below.'
					);
				} else if ( isImportTimedOut ) {
					message = __(
						"A timeout error occurred while pushing the site, likely due to its large size. Please try reducing the site's content or files and try again. If this problem persists, please contact support."
					);
				} else {
					message = __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					);
				}
				return rejectWithValue( {
					selectedSiteId,
					remoteSiteId,
					errorInfo: {
						title: sprintf( __( 'Error pushing to %s' ), currentPushState.selectedSite.name ),
						message,
						showOpenLogs: true,
					},
				} );
			}
			case 'initial_backup_started':
				status = pushStatesProgressInfo.creatingRemoteBackup;
				break;
			case 'archive_import_started':
				status = pushStatesProgressInfo.applyingChanges;
				break;
			case 'archive_import_finished':
				status = pushStatesProgressInfo.finishing;
				break;
		}
		// Calculate push status with progress
		if ( status.key === pushStatesProgressInfo.creatingRemoteBackup.key ) {
			const progressRange =
				pushStatesProgressInfo.applyingChanges.progress -
				pushStatesProgressInfo.creatingRemoteBackup.progress;
			status = {
				...status,
				progress:
					pushStatesProgressInfo.creatingRemoteBackup.progress +
					progressRange * ( response.backup_progress / 100 ),
			};
		} else if (
			status.key === pushStatesProgressInfo.applyingChanges.key &&
			response.import_progress < 100
		) {
			const progressRange =
				pushStatesProgressInfo.finishing.progress - pushStatesProgressInfo.applyingChanges.progress;
			status = {
				...status,
				progress:
					pushStatesProgressInfo.applyingChanges.progress +
					progressRange * ( response.import_progress / 100 ),
			};
		}
		// Update state in any case to keep polling push state
		dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId,
				remoteSiteId,
				state: { status },
			} )
		);
	},
	{
		condition: ( { selectedSiteId, remoteSiteId }, { getState } ) => {
			const pushState = syncOperationsSelectors.selectPushState(
				selectedSiteId,
				remoteSiteId
			)( getState() );
			return !! pushState?.status && pushState.status.key !== 'cancelled';
		},
	}
);

// Constants for pull progress calculation (from useSyncStatesProgressInfo)
const IN_PROGRESS_INITIAL_VALUE = 30;
const DOWNLOADING_INITIAL_VALUE = 60;
const IN_PROGRESS_TO_DOWNLOADING_STEP = DOWNLOADING_INITIAL_VALUE - IN_PROGRESS_INITIAL_VALUE;

// Thunk for polling pull backup status
type PollPullBackupPayload = {
	client: WPCOM;
	selectedSiteId: string;
	remoteSiteId: number;
};

export const pollPullBackupThunk = createTypedAsyncThunk(
	'syncOperations/pollPullBackup',
	async (
		{ client, selectedSiteId, remoteSiteId }: PollPullBackupPayload,
		{ dispatch, getState, rejectWithValue }
	) => {
		const pullStatesProgressInfo = getPullStatesProgressInfo();
		// condition guarantees currentPullState exists and is not cancelled
		const currentPullState = syncOperationsSelectors.selectPullState(
			selectedSiteId,
			remoteSiteId
		)( getState() )!;

		const backupId = currentPullState.backupId;
		if ( ! backupId ) {
			console.error( 'No backup ID found' );
			return;
		}

		try {
			const response = await client.req.get< SyncBackupResponse >(
				`/sites/${ remoteSiteId }/studio-app/sync/backup`,
				{
					apiNamespace: 'wpcom/v2',
					backup_id: backupId,
				}
			);

			if ( ! response.status ) {
				throw new Error( 'Unexpected backup response: missing status' );
			}

			const hasBackupCompleted = response.status === 'finished';
			const downloadUrl = hasBackupCompleted ? response.download_url : null;

			if ( downloadUrl ) {
				// Backup completed, handle download and import
				const { selectedSite, remoteSiteUrl } = currentPullState;

				// Check file size
				const fileSize = await getIpcApi().checkSyncBackupSize( downloadUrl );

				if ( fileSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
					const CANCEL_ID = 1;

					const { response: userChoice } = await getIpcApi().showMessageBox( {
						type: 'warning',
						message: __( "Large site's backup" ),
						detail: sprintf(
							__(
								"Your site's backup exceeds %d GB. Pulling it will prevent you from pushing the site back.\n\nDo you want to continue?"
							),
							SYNC_PUSH_SIZE_LIMIT_GB
						),
						buttons: [ __( 'Continue' ), __( 'Cancel' ) ],
						defaultId: 0,
						cancelId: CANCEL_ID,
					} );

					if ( userChoice === CANCEL_ID ) {
						dispatch(
							syncOperationsActions.updatePullState( {
								selectedSiteId,
								remoteSiteId,
								state: {
									status: pullStatesProgressInfo.cancelled,
								},
							} )
						);
						void dispatch(
							syncOperationsThunks.clearPullState( { selectedSiteId, remoteSiteId } )
						);
						return;
					}
				}

				// Update to downloading
				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.downloading,
							downloadUrl,
						},
					} )
				);

				// Download backup
				const operationId = generateStateId( selectedSiteId, remoteSiteId );
				const filePath = await getIpcApi().downloadSyncBackup(
					remoteSiteId,
					downloadUrl,
					operationId
				);

				// Check if cancelled after download
				const stateAfterDownload = getState();
				const pullStateAfterDownload = syncOperationsSelectors.selectPullState(
					selectedSiteId,
					remoteSiteId
				)( stateAfterDownload );

				if (
					! pullStateAfterDownload ||
					! pullStateAfterDownload.status ||
					pullStateAfterDownload.status.key === 'cancelled'
				) {
					return;
				}

				// Update to importing
				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.importing,
						},
					} )
				);

				// Stop server, import, then start server
				await getIpcApi().stopServer( selectedSiteId );
				await getIpcApi().importSite( {
					id: selectedSiteId,
					backupFile: {
						path: filePath,
						type: 'application/tar+gzip',
					},
				} );
				await getIpcApi().startServer( selectedSiteId );

				// Clean up
				await getIpcApi().removeSyncBackup( remoteSiteId );

				// Update site timestamp
				void dispatch(
					connectedSitesApi.endpoints.updateSiteTimestamp.initiate( {
						siteId: remoteSiteId,
						localSiteId: selectedSiteId,
						type: 'pull',
					} )
				);

				// Mark as finished
				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.finished,
						},
					} )
				);

				// Show notification
				getIpcApi().showNotification( {
					title: selectedSite.name,
					body: sprintf(
						// translators: %s is the site url without the protocol.
						__( 'Studio site has been updated from %s' ),
						getHostnameFromUrl( remoteSiteUrl )
					),
				} );
			} else {
				// Calculate backup status with progress
				const frontendStatus = hasBackupCompleted
					? pullStatesProgressInfo.downloading.key
					: response.status;
				let statusWithProgress: PullStateProgressInfo = pullStatesProgressInfo[ frontendStatus ];
				if ( response.status === 'in-progress' ) {
					statusWithProgress = {
						...pullStatesProgressInfo[ frontendStatus ],
						progress:
							IN_PROGRESS_INITIAL_VALUE +
							IN_PROGRESS_TO_DOWNLOADING_STEP * ( response.percent / 100 ),
					};
				}

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: statusWithProgress,
							downloadUrl,
						},
					} )
				);
			}
		} catch ( error ) {
			console.error( 'Pull backup polling/completion failed:', error );

			// Check if cancelled
			const errorState = getState();
			const pullStateOnError = syncOperationsSelectors.selectPullState(
				selectedSiteId,
				remoteSiteId
			)( errorState );

			if (
				pullStateOnError &&
				pullStateOnError.status &&
				pullStateOnError.status.key === 'cancelled'
			) {
				return;
			}

			Sentry.captureException( error );
			return rejectWithValue( {
				selectedSiteId,
				remoteSiteId,
				errorInfo: {
					title: sprintf( __( 'Error pulling from %s' ), currentPullState.selectedSite.name ),
					message: __( 'Failed to check backup file size. Please try again.' ),
				},
			} );
		}
	},
	{
		condition: ( { selectedSiteId, remoteSiteId }, { getState } ) => {
			const pullState = syncOperationsSelectors.selectPullState(
				selectedSiteId,
				remoteSiteId
			)( getState() );
			return !! pullState?.status && pullState.status.key !== 'cancelled';
		},
	}
);

/**
 * Maps an ImportResponse status to a PushStateProgressInfo object.
 * Returns null if the operation is not in progress or unknown.
 */
export function mapImportResponseToPushState(
	response: ImportResponse
): PushStateProgressInfo | null {
	const pushStatesProgressInfo = getPushStatesProgressInfo();
	switch ( response.status ) {
		case 'initial_backup_started':
			return pushStatesProgressInfo.creatingRemoteBackup;
		case 'archive_import_started':
			return pushStatesProgressInfo.applyingChanges;
		case 'archive_import_finished':
			return pushStatesProgressInfo.finishing;
		default:
			return null;
	}
}

// Thunk to initialize push states from in-progress server operations on mount
type InitializeSyncStatesPayload = {
	client: WPCOM;
};

export const initializeSyncStatesThunk = createTypedAsyncThunk(
	'syncOperations/initializeSyncStates',
	async ( { client }: InitializeSyncStatesPayload, { dispatch } ) => {
		const allSites = await getIpcApi().getSiteDetails();
		const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

		for ( const connectedSite of allConnectedSites ) {
			try {
				const localSite = allSites.find( ( site ) => site.id === connectedSite.localSiteId );
				const hasConnectionErrors = connectedSite?.syncSupport !== 'already-connected';

				if ( ! localSite || hasConnectionErrors ) {
					continue;
				}

				const response = ( await client.req.get(
					`/sites/${ connectedSite.id }/studio-app/sync/import`,
					{
						apiNamespace: 'wpcom/v2',
					}
				) ) as ImportResponse;

				const status = mapImportResponseToPushState( response );

				// Only restore the pushStates if the operation is still in progress
				if ( status ) {
					dispatch(
						syncOperationsActions.updatePushState( {
							selectedSiteId: connectedSite.localSiteId,
							remoteSiteId: connectedSite.id,
							state: {
								status,
								selectedSite: localSite,
								remoteSiteUrl: connectedSite.url,
							},
						} )
					);
				}
			} catch ( error ) {
				// Continue checking other sites even if one fails
				console.error( `Failed to check push progress for site ${ connectedSite.id }:`, error );
			}
		}
	}
);

// Export thunks object for convenience (must be after all thunk declarations)
export const syncOperationsThunks = {
	clearPushState: clearPushStateThunk,
	clearPullState: clearPullStateThunk,
	cancelPush: cancelPushThunk,
	cancelPull: cancelPullThunk,
	pushSite: pushSiteThunk,
	pullSite: pullSiteThunk,
	pollPushProgress: pollPushProgressThunk,
	pollPullBackup: pollPullBackupThunk,
	initializeSyncStates: initializeSyncStatesThunk,
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
		return Object.values( state.syncOperations.pullStates ).some(
			( pullState ) => pullState.status && isKeyPulling( pullState.status.key )
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
					return (
						pullState.status &&
						isKeyPulling( pullState.status.key ) &&
						pullState.remoteSiteId === remoteSiteId
					);
				}
				return pullState.status && isKeyPulling( pullState.status.key );
			} );
		},
	selectIsAnySitePushing: ( state: { syncOperations: SyncOperationsState } ): boolean => {
		return Object.values( state.syncOperations.pushStates ).some(
			( pushState ) => pushState.status && isKeyPushing( pushState.status.key )
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
					return (
						pushState.status &&
						isKeyPushing( pushState.status.key ) &&
						pushState.remoteSiteId === remoteSiteId
					);
				}
				return pushState.status && isKeyPushing( pushState.status.key );
			} );
		},
};
