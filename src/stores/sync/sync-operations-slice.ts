import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { WPCOM } from 'wpcom/types';
import { SYNC_PUSH_SIZE_LIMIT_BYTES, SYNC_PUSH_SIZE_LIMIT_GB } from 'src/constants';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getHostnameFromUrl } from 'src/lib/url-utils';
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

// Helper function to calculate push status with progress (inlined from useSyncStatesProgressInfo)
const getPushStatusWithProgress = (
	status: PushStateProgressInfo,
	response: ImportResponse,
	pushStatesProgressInfo: Record< PushStateProgressInfo[ 'key' ], PushStateProgressInfo >
): PushStateProgressInfo => {
	if ( status.key === pushStatesProgressInfo.creatingRemoteBackup.key ) {
		const progressRange =
			pushStatesProgressInfo.applyingChanges.progress -
			pushStatesProgressInfo.creatingRemoteBackup.progress;

		// This step will increase the progress to the next step progressively based on the backup_progress
		return {
			...status,
			progress:
				pushStatesProgressInfo.creatingRemoteBackup.progress +
				progressRange * ( response.backup_progress / 100 ),
		};
	}

	// This step will increase the progress to the next step progressively based on the import_progress
	if (
		status.key === pushStatesProgressInfo.applyingChanges.key &&
		response.import_progress < 100
	) {
		const progressRange =
			pushStatesProgressInfo.finishing.progress - pushStatesProgressInfo.applyingChanges.progress;
		return {
			...status,
			progress:
				pushStatesProgressInfo.applyingChanges.progress +
				progressRange * ( response.import_progress / 100 ),
		};
	}
	return status;
};

// Thunk for polling push progress
type PollPushProgressPayload = {
	client: WPCOM;
	selectedSiteId: string;
	remoteSiteId: number;
	pushStatesProgressInfo: Record< PushStateProgressInfo[ 'key' ], PushStateProgressInfo >;
};

export const pollPushProgressThunk = createTypedAsyncThunk(
	'syncOperations/pollPushProgress',
	async (
		{ client, selectedSiteId, remoteSiteId, pushStatesProgressInfo }: PollPushProgressPayload,
		{ dispatch, getState }
	) => {
		// Check if state exists and is not cancelled
		const state = getState();
		const currentPushState = syncOperationsSelectors.selectPushState(
			selectedSiteId,
			remoteSiteId
		)( state );

		if ( ! currentPushState || isKeyCancelled( currentPushState.status.key ) ) {
			return;
		}

		const response = await client.req.get< ImportResponse >(
			`/sites/${ remoteSiteId }/studio-app/sync/import`,
			{
				apiNamespace: 'wpcom/v2',
			}
		);

		let status: PushStateProgressInfo = pushStatesProgressInfo.creatingRemoteBackup;
		if ( response.success && response.status === 'finished' ) {
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
		} else if ( response.success && response.status === 'failed' ) {
			status = pushStatesProgressInfo.failed;
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

			getIpcApi().showErrorMessageBox( {
				title: sprintf( __( 'Error pushing to %s' ), currentPushState.selectedSite.name ),
				message,
				showOpenLogs: true,
			} );
		} else if ( response.success && response.status === 'archive_import_started' ) {
			status = pushStatesProgressInfo.applyingChanges;
		} else if ( response.success && response.status === 'archive_import_finished' ) {
			status = pushStatesProgressInfo.finishing;
		}
		status = getPushStatusWithProgress( status, response, pushStatesProgressInfo );
		// Update state in any case to keep polling push state
		updatePushStateWithIpc(
			dispatch,
			selectedSiteId,
			remoteSiteId,
			{ status },
			isKeyFailed,
			isKeyFinished
		);
	}
);

// Constants for pull progress calculation (from useSyncStatesProgressInfo)
const IN_PROGRESS_INITIAL_VALUE = 30;
const DOWNLOADING_INITIAL_VALUE = 60;
const IN_PROGRESS_TO_DOWNLOADING_STEP = DOWNLOADING_INITIAL_VALUE - IN_PROGRESS_INITIAL_VALUE;

// Helper function to calculate backup status with progress (inlined from useSyncStatesProgressInfo)
const getBackupStatusWithProgress = (
	hasBackupCompleted: boolean,
	pullStatesProgressInfo: Record< PullStateProgressInfo[ 'key' ], PullStateProgressInfo >,
	response: SyncBackupResponse
): PullStateProgressInfo => {
	const frontendStatus = hasBackupCompleted
		? pullStatesProgressInfo.downloading.key
		: response.status;
	let newProgressInfo: PullStateProgressInfo | null = null;
	if ( response.status === 'in-progress' ) {
		newProgressInfo = {
			...pullStatesProgressInfo[ frontendStatus ],
			// Update progress from the initial value to the new step proportionally to the response.progress
			// on every update of the response.progress
			progress:
				IN_PROGRESS_INITIAL_VALUE + IN_PROGRESS_TO_DOWNLOADING_STEP * ( response.percent / 100 ),
		};
	}
	const statusWithProgress = newProgressInfo || pullStatesProgressInfo[ frontendStatus ];

	return statusWithProgress;
};

// Thunk for polling pull backup status
type PollPullBackupPayload = {
	client: WPCOM;
	selectedSiteId: string;
	remoteSiteId: number;
	pullStatesProgressInfo: Record< PullStateProgressInfo[ 'key' ], PullStateProgressInfo >;
};

export const pollPullBackupThunk = createTypedAsyncThunk(
	'syncOperations/pollPullBackup',
	async (
		{ client, selectedSiteId, remoteSiteId, pullStatesProgressInfo }: PollPullBackupPayload,
		{ dispatch, getState }
	) => {
		// Check if state exists and is not cancelled
		const state = getState();
		const currentPullState = syncOperationsSelectors.selectPullState(
			selectedSiteId,
			remoteSiteId
		)( state );

		if ( ! currentPullState || isKeyCancelled( currentPullState.status.key ) ) {
			return;
		}

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

			const hasBackupCompleted = response.status === 'finished';
			const downloadUrl = hasBackupCompleted ? response.download_url : null;

			if ( downloadUrl ) {
				// Backup completed, trigger completion thunk
				await dispatch(
					syncOperationsThunks.completePull( {
						selectedSiteId,
						remoteSiteId,
						downloadUrl,
						pullStatesProgressInfo,
					} )
				).unwrap();
			} else {
				// Update status with progress
				const statusWithProgress = getBackupStatusWithProgress(
					hasBackupCompleted,
					pullStatesProgressInfo,
					response
				);

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

				// Update IPC sync operation
				const stateId = generateStateId( selectedSiteId, remoteSiteId );
				getIpcApi().addSyncOperation( stateId );
			}
		} catch ( error ) {
			console.error( 'Failed to fetch backup status:', error );
			throw error;
		}
	}
);

// Thunk for completing pull operation (handles download, import, server start)
type CompletePullPayload = {
	selectedSiteId: string;
	remoteSiteId: number;
	downloadUrl: string;
	pullStatesProgressInfo: Record< PullStateProgressInfo[ 'key' ], PullStateProgressInfo >;
};

export const completePullThunk = createTypedAsyncThunk(
	'syncOperations/completePull',
	async (
		{ selectedSiteId, remoteSiteId, downloadUrl, pullStatesProgressInfo }: CompletePullPayload,
		{ dispatch, getState }
	) => {
		// Check if cancelled
		const state = getState();
		const currentPullState = syncOperationsSelectors.selectPullState(
			selectedSiteId,
			remoteSiteId
		)( state );

		if ( ! currentPullState || isKeyCancelled( currentPullState.status.key ) ) {
			return;
		}

		const { selectedSite, remoteSiteUrl } = currentPullState;

		try {
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
					void dispatch( syncOperationsThunks.clearPullState( { selectedSiteId, remoteSiteId } ) );
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

			if ( ! pullStateAfterDownload || isKeyCancelled( pullStateAfterDownload.status.key ) ) {
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
		} catch ( error ) {
			console.error( 'Backup completion failed:', error );

			// Check if cancelled
			const errorState = getState();
			const pullStateOnError = syncOperationsSelectors.selectPullState(
				selectedSiteId,
				remoteSiteId
			)( errorState );

			if ( pullStateOnError && isKeyCancelled( pullStateOnError.status.key ) ) {
				return;
			}

			Sentry.captureException( error );
			dispatch(
				syncOperationsActions.updatePullState( {
					selectedSiteId,
					remoteSiteId,
					state: {
						status: pullStatesProgressInfo.failed,
					},
				} )
			);
			getIpcApi().showErrorMessageBox( {
				title: sprintf( __( 'Error pulling from %s' ), selectedSite.name ),
				message: __( 'Failed to check backup file size. Please try again.' ),
			} );
			throw error;
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
	completePull: completePullThunk,
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
