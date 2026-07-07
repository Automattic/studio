import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import {
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import {
	pullSiteResponseSchema,
	syncBackupResponseSchema,
	importResponseSchema,
} from '@studio/common/types/sync';
import { __, sprintf } from '@wordpress/i18n';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getHostnameFromUrl } from 'src/lib/url-utils';
import { store } from 'src/stores';
import { userLoggedOut } from 'src/stores/auth-actions';
import { connectedSitesApi } from 'src/stores/sync/connected-sites';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { ImportResponse, SyncSite } from '@studio/common/types/sync';
import type {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import type { AppDispatch, RootState } from 'src/stores';
import type { SyncOption } from 'src/types';
import type { WPCOM } from 'wpcom/types';

async function updateSiteTimestamp( {
	siteId,
	localSiteId,
	type,
}: {
	siteId: number;
	localSiteId: string;
	type: 'pull' | 'push';
} ) {
	const connectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
	const connectedSite = connectedSites.find(
		( { id, localSiteId: siteLocalId } ) => siteId === id && localSiteId === siteLocalId
	);

	if ( ! connectedSite ) {
		return;
	}

	const timestampKey = type === 'pull' ? 'lastPullTimestamp' : 'lastPushTimestamp';
	await getIpcApi().updateConnectedWpcomSites( [
		{
			...connectedSite,
			[ timestampKey ]: new Date().toISOString(),
		},
	] );
}

export type SyncBackupState = {
	remoteSiteId: number;
	backupId: number | null;
	status: PullStateProgressInfo;
	downloadUrl: string | null;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
};

export type PullSiteOptions = {
	optionsToSync: SyncOption[];
	include_path_list?: string[];
};

export type PullStates = Record< string, SyncBackupState >;

export type SyncPushState = {
	remoteSiteId: number;
	status: PushStateProgressInfo;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
	uploadProgress?: number;
};

export type PushStates = Record< string, SyncPushState >;

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

type SyncOperationsState = {
	pullStates: PullStates;
	pushStates: PushStates;
};

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
			};
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
			};
		},

		clearPushState: ( state, action: PayloadAction< ClearStatePayload > ) => {
			const { selectedSiteId, remoteSiteId } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			delete state.pushStates[ stateId ];
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( userLoggedOut, () => initialState )
			.addCase( pushSiteThunk.rejected, ( state, action ) => {
				const { connectedSite, selectedSite } = action.meta.arg;
				const stateId = generateStateId( selectedSite.id, connectedSite.id );
				if ( ! action.meta.aborted && state.pushStates[ stateId ] ) {
					state.pushStates[ stateId ].status = getPushStatesProgressInfo().failed;
				}
			} )
			.addCase( pollPushProgressThunk.rejected, ( state, action ) => {
				const { remoteSiteId, selectedSiteId } = action.meta.arg;
				const stateId = generateStateId( selectedSiteId, remoteSiteId );
				if ( ! action.meta.aborted && state.pushStates[ stateId ] ) {
					state.pushStates[ stateId ].status = getPushStatesProgressInfo().failed;
				}
			} )
			.addCase( pullSiteThunk.rejected, ( state, action ) => {
				const { connectedSite, selectedSite } = action.meta.arg;
				const stateId = generateStateId( selectedSite.id, connectedSite.id );
				if ( ! action.meta.aborted && state.pullStates[ stateId ] ) {
					state.pullStates[ stateId ].status = getPullStatesProgressInfo().failed;
				}
			} )
			.addCase( pollPullBackupThunk.rejected, ( state, action ) => {
				const { remoteSiteId, selectedSiteId } = action.meta.arg;
				const stateId = generateStateId( selectedSiteId, remoteSiteId );
				if ( ! action.meta.aborted && state.pullStates[ stateId ] ) {
					state.pullStates[ stateId ].status = getPullStatesProgressInfo().failed;
				}
			} );
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

window.ipcListener.subscribe( 'sync-upload-network-paused', ( _event, payload ) => {
	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: getPushStatesProgressInfo().uploadingPaused,
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-manually-paused', ( _event, payload ) => {
	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: getPushStatesProgressInfo().uploadingManuallyPaused,
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-progress', ( _event, payload ) => {
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
					...getPushStatesProgressInfo().uploading,
					progress: overallProgress,
				},
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-resumed', ( _event, payload ) => {
	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: getPushStatesProgressInfo().uploading,
			},
		} )
	);
} );

// Poller infrastructure — manages AbortControllers for push/pull polling loops
const PUSH_POLLERS = new Map< string, AbortController >();
const PULL_POLLERS = new Map< string, AbortController >();

export function stopPushPoller( stateId: string ) {
	PUSH_POLLERS.get( stateId )?.abort();
	PUSH_POLLERS.delete( stateId );
}

export function stopPullPoller( stateId: string ) {
	PULL_POLLERS.get( stateId )?.abort();
	PULL_POLLERS.delete( stateId );
}

// Aborts every in-flight push/pull (pollers, push upload abort callbacks, and
// the corresponding main-process operations) without dispatching any state
// updates. Use from the userLoggedOut listener; rely on the slice's
// addCase(userLoggedOut) for state cleanup.
export function abortAllSyncOperations() {
	const operationIds = new Set< string >( [
		...PUSH_POLLERS.keys(),
		...PULL_POLLERS.keys(),
		...PUSH_SITE_ABORT_CALLBACKS.keys(),
	] );

	for ( const operationId of operationIds ) {
		stopPushPoller( operationId );
		stopPullPoller( operationId );
		PUSH_SITE_ABORT_CALLBACKS.get( operationId )?.();
		getIpcApi().cancelSyncOperation( operationId );
	}
	PUSH_SITE_ABORT_CALLBACKS.clear();
}

const PUSH_POLLING_KEYS = [ 'creatingRemoteBackup', 'applyingChanges', 'finishing' ];
const SYNC_POLLING_INTERVAL = 3000;

function isPushPollable( selectedSiteId: string, remoteSiteId: number ) {
	const pushState = syncOperationsSelectors.selectPushState(
		selectedSiteId,
		remoteSiteId
	)( store.getState() );
	return pushState && PUSH_POLLING_KEYS.includes( pushState.status.key );
}

function isPullPollable( selectedSiteId: string, remoteSiteId: number ) {
	const pullState = syncOperationsSelectors.selectPullState(
		selectedSiteId,
		remoteSiteId
	)( store.getState() );
	return pullState?.status.key === 'in-progress' && !! pullState.backupId;
}

async function startPushPoller( selectedSiteId: string, remoteSiteId: number ) {
	const stateId = generateStateId( selectedSiteId, remoteSiteId );
	if ( PUSH_POLLERS.has( stateId ) ) {
		return;
	}

	const controller = new AbortController();
	PUSH_POLLERS.set( stateId, controller );

	try {
		while ( ! controller.signal.aborted ) {
			const client = getWpcomClient();
			if ( ! client ) {
				break;
			}

			await store.dispatch(
				pollPushProgressThunk( {
					client,
					signal: controller.signal,
					selectedSiteId,
					remoteSiteId,
				} )
			);

			if ( controller.signal.aborted || ! isPushPollable( selectedSiteId, remoteSiteId ) ) {
				break;
			}

			await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLLING_INTERVAL ) );
		}
	} finally {
		if ( PUSH_POLLERS.get( stateId ) === controller ) {
			PUSH_POLLERS.delete( stateId );
		}
	}
}

async function startPullPoller( selectedSiteId: string, remoteSiteId: number ) {
	const stateId = generateStateId( selectedSiteId, remoteSiteId );
	if ( PULL_POLLERS.has( stateId ) ) {
		return;
	}

	const controller = new AbortController();
	PULL_POLLERS.set( stateId, controller );

	try {
		while ( ! controller.signal.aborted ) {
			const client = getWpcomClient();
			if ( ! client ) {
				break;
			}

			await store.dispatch(
				pollPullBackupThunk( {
					client,
					signal: controller.signal,
					selectedSiteId,
					remoteSiteId,
				} )
			);

			if ( controller.signal.aborted || ! isPullPollable( selectedSiteId, remoteSiteId ) ) {
				break;
			}

			await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLLING_INTERVAL ) );
		}
	} finally {
		if ( PULL_POLLERS.get( stateId ) === controller ) {
			PULL_POLLERS.delete( stateId );
		}
	}
}

const createTypedAsyncThunk = createAsyncThunk.withTypes< {
	state: RootState;
	dispatch: AppDispatch;
	rejectValue: {
		title: string;
		message: string;
		showOpenLogs?: boolean;
		error?: unknown;
	};
} >();

type CancelOperationPayload = {
	selectedSiteId: string;
	remoteSiteId: number;
};

const cancelPushThunk = createTypedAsyncThunk(
	'syncOperations/cancelPush',
	async ( { selectedSiteId, remoteSiteId }: CancelOperationPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );

		stopPushPoller( operationId );
		PUSH_SITE_ABORT_CALLBACKS.get( operationId )?.();
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

const cancelPullThunk = createTypedAsyncThunk(
	'syncOperations/cancelPull',
	async ( { selectedSiteId, remoteSiteId }: CancelOperationPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );
		stopPullPoller( operationId );
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

const getErrorFromResponse = ( error: unknown ): string => {
	if (
		typeof error === 'object' &&
		error !== null &&
		'error' in error &&
		typeof error.error === 'string'
	) {
		return error.error;
	}
	return __( 'Studio was unable to connect to WordPress.com. Please try again.' );
};

const PUSH_SITE_ABORT_CALLBACKS: Map< string, ( reason?: string | undefined ) => void > = new Map();

type PushSitePayload = {
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
	options?: {
		optionsToSync?: SyncOption[];
		specificSelectionPaths?: string[];
	};
};

const pushSiteThunk = createTypedAsyncThunk< void, PushSitePayload >(
	'syncOperations/pushSite',
	async (
		{ connectedSite, selectedSite, options },
		{ abort, dispatch, signal, rejectWithValue }
	) => {
		const pushStatesProgressInfo = getPushStatesProgressInfo();
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;
		const operationId = generateStateId( selectedSite.id, remoteSiteId );

		try {
			PUSH_SITE_ABORT_CALLBACKS.set( operationId, abort );

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

			const { archivePath, archiveSizeInBytes } = await getIpcApi().exportSiteForPush(
				selectedSite.id,
				operationId,
				{
					optionsToSync: options?.optionsToSync,
					specificSelectionPaths: options?.specificSelectionPaths,
				}
			);
			signal.throwIfAborted();

			if ( archiveSizeInBytes > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
				return rejectWithValue( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'The site is too large to push. Please reduce the size of the site and try again.'
					),
				} );
			}

			dispatch(
				syncOperationsActions.updatePushState( {
					selectedSiteId: selectedSite.id,
					remoteSiteId,
					state: { status: pushStatesProgressInfo.uploading },
				} )
			);

			const response = await getIpcApi().pushArchive(
				selectedSite.id,
				remoteSiteId,
				archivePath,
				options?.optionsToSync,
				options?.specificSelectionPaths
			);
			signal.throwIfAborted();

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
				void startPushPoller( selectedSite.id, remoteSiteId );
			} else {
				return rejectWithValue( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: getErrorFromResponse( response ),
				} );
			}
		} catch ( error ) {
			if ( signal.aborted ) {
				return;
			}
			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
				message: getErrorFromResponse( error ),
			} );
		} finally {
			PUSH_SITE_ABORT_CALLBACKS.delete( operationId );
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
	backupId: number;
	remoteSiteId: number;
};

export const pullSiteThunk = createTypedAsyncThunk< PullSiteResult, PullSitePayload >(
	'syncOperations/pullSite',
	async (
		{ client, connectedSite, selectedSite, options },
		{ dispatch, getState, rejectWithValue }
	) => {
		const pullStatesProgressInfo = getPullStatesProgressInfo();
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;

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

			const rawResponse = await client.req.post( {
				path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
				apiNamespace: 'wpcom/v2',
				body: requestBody,
			} );
			const response = pullSiteResponseSchema.parse( rawResponse );

			if ( response.success ) {
				// Creating the remote backup can take a while. If the user logged out (slice
				// reset) or cancelled the pull while this request was in flight, don't resurrect
				// the pull state or start a poller — that would leave an orphaned pull stuck at
				// "Initializing remote backup…" after logout.
				const currentState = syncOperationsSelectors.selectPullState(
					selectedSite.id,
					remoteSiteId
				)( getState() );
				const isStillActive = !! currentState && currentState.status.key !== 'cancelled';

				if ( isStillActive ) {
					dispatch(
						syncOperationsActions.updatePullState( {
							selectedSiteId: selectedSite.id,
							remoteSiteId,
							state: {
								backupId: response.backup_id,
							},
						} )
					);
					void startPullPoller( selectedSite.id, remoteSiteId );
				}

				return {
					backupId: response.backup_id,
					remoteSiteId,
				};
			} else {
				throw new Error( 'Pull request failed' );
			}
		} catch ( error ) {
			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
				message: __( 'Studio was unable to connect to WordPress.com. Please try again.' ),
			} );
		}
	}
);

// Thunk for polling push progress
type PollPushProgressPayload = {
	client: WPCOM;
	selectedSiteId: string;
	signal: AbortSignal;
	remoteSiteId: number;
};

const pollPushProgressThunk = createTypedAsyncThunk(
	'syncOperations/pollPushProgress',
	async (
		{ client, selectedSiteId, signal, remoteSiteId }: PollPushProgressPayload,
		{ dispatch, getState, rejectWithValue }
	) => {
		const pushStatesProgressInfo = getPushStatesProgressInfo();
		// condition guarantees currentPushState exists and is not cancelled
		const currentPushState = syncOperationsSelectors.selectPushState(
			selectedSiteId,
			remoteSiteId
		)( getState() );
		if ( ! currentPushState ) {
			return;
		}

		try {
			const rawResponse = await client.req.get( `/sites/${ remoteSiteId }/studio-app/sync/import`, {
				apiNamespace: 'wpcom/v2',
			} );
			const response = importResponseSchema.parse( rawResponse );

			signal.throwIfAborted();

			if ( ! response.success ) {
				return rejectWithValue( {
					title: sprintf( __( 'Error pushing to %s' ), currentPushState.selectedSite.name ),
					message: __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					),
				} );
			}

			let status: PushStateProgressInfo;
			switch ( response.status ) {
				case 'finished':
					status = pushStatesProgressInfo.finished;
					await updateSiteTimestamp( {
						siteId: remoteSiteId,
						localSiteId: selectedSiteId,
						type: 'push',
					} );
					void dispatch( connectedSitesApi.util.invalidateTags( [ 'ConnectedSites' ] ) );
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
						title: sprintf( __( 'Error pushing to %s' ), currentPushState.selectedSite.name ),
						message,
						showOpenLogs: true,
					} );
				}
				case 'started':
				case 'initial_backup_started':
				case 'initial_backup_finished':
					status = pushStatesProgressInfo.creatingRemoteBackup;
					if ( response.backup_progress ) {
						const progressRange = pushStatesProgressInfo.applyingChanges.progress - status.progress;
						status.progress = status.progress + progressRange * ( response.backup_progress / 100 );
					}
					break;
				case 'archive_import_started':
					status = pushStatesProgressInfo.applyingChanges;
					if ( response.import_progress ) {
						const progressRange = pushStatesProgressInfo.finishing.progress - status.progress;
						status.progress = status.progress + progressRange * ( response.import_progress / 100 );
					}
					break;
				case 'archive_import_finished':
					status = pushStatesProgressInfo.finishing;
					break;
			}

			dispatch(
				syncOperationsActions.updatePushState( {
					selectedSiteId,
					remoteSiteId,
					state: { status },
				} )
			);
		} catch ( error ) {
			if ( signal.aborted ) {
				return;
			}

			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pushing from %s' ), currentPushState.selectedSite.name ),
				message: __( 'Failed to check backup file size. Please try again.' ),
			} );
		}
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
	signal: AbortSignal;
	remoteSiteId: number;
};

const pollPullBackupThunk = createTypedAsyncThunk(
	'syncOperations/pollPullBackup',
	async (
		{ client, selectedSiteId, remoteSiteId, signal }: PollPullBackupPayload,
		{ dispatch, getState, rejectWithValue }
	) => {
		const pullStatesProgressInfo = getPullStatesProgressInfo();
		const currentPullState = syncOperationsSelectors.selectPullState(
			selectedSiteId,
			remoteSiteId
		)( getState() );

		if ( ! currentPullState ) {
			return;
		}

		const backupId = currentPullState.backupId;
		if ( ! backupId ) {
			console.error( 'No backup ID found' );
			return;
		}

		try {
			const rawResponse = await client.req.get( `/sites/${ remoteSiteId }/studio-app/sync/backup`, {
				apiNamespace: 'wpcom/v2',
				backup_id: backupId,
			} );
			const parseResult = syncBackupResponseSchema.safeParse( rawResponse );
			if ( ! parseResult.success ) {
				console.error( 'Unexpected backup status response:', rawResponse );
				throw new Error( __( 'Unexpected response from server while checking backup status' ) );
			}
			const response = parseResult.data;

			signal.throwIfAborted();

			const hasBackupCompleted = response.status === 'finished';
			const downloadUrl = hasBackupCompleted ? response.download_url : null;

			if ( downloadUrl ) {
				const { selectedSite, remoteSiteUrl } = currentPullState;

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
							syncOperationsActions.clearPullState( { selectedSiteId, remoteSiteId } )
						);
						return;
					}
				}

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

				const operationId = generateStateId( selectedSiteId, remoteSiteId );
				const filePath = await getIpcApi().downloadSyncBackup(
					remoteSiteId,
					downloadUrl,
					operationId
				);

				// downloadSyncBackup resolves without a path when it was cancelled (e.g. the user
				// logged out mid-download). Stop silently instead of importing a missing backup.
				if ( signal.aborted || ! filePath ) {
					return;
				}

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.importing,
						},
					} )
				);

				await getIpcApi().importSite( selectedSiteId, filePath, {
					alwaysStartServer: true,
					removeBackupOnComplete: true,
					showErrorModal: false,
					showNotification: false,
				} );

				// The import runs locally and is intentionally not aborted on logout, but if the
				// user logged out / cancelled while it finished, don't surface post-logout
				// "finished" UI (notification + re-populated sync state).
				if ( signal.aborted ) {
					return;
				}

				await updateSiteTimestamp( {
					siteId: remoteSiteId,
					localSiteId: selectedSiteId,
					type: 'pull',
				} );
				void dispatch( connectedSitesApi.util.invalidateTags( [ 'ConnectedSites' ] ) );

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.finished,
						},
					} )
				);

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
				let statusWithProgress = pullStatesProgressInfo[ frontendStatus ];
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
						},
					} )
				);
			}
		} catch ( error ) {
			// The poller signal is aborted on user cancel and on logout cleanup — both are
			// intentional stops, so don't capture the error or show the "Error pulling" modal.
			// (On logout the slice is reset, so we can't rely on the state still being
			// 'cancelled' here — the aborted signal is the reliable signal.)
			if ( signal.aborted ) {
				return;
			}

			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pulling from %s' ), currentPullState.selectedSite.name ),
				message: error instanceof Error ? error.message : String( error ),
			} );
		}
	}
);

/**
 * Maps an ImportResponse status to a PushStateProgressInfo object.
 * Returns null if the operation is not in progress or unknown.
 */
function mapImportResponseToPushState( response: ImportResponse ): PushStateProgressInfo | null {
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

				const rawResponse = await client.req.get(
					`/sites/${ connectedSite.id }/studio-app/sync/import`,
					{ apiNamespace: 'wpcom/v2' }
				);
				const response = importResponseSchema.parse( rawResponse );

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
					void startPushPoller( connectedSite.localSiteId, connectedSite.id );
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
	cancelPush: cancelPushThunk,
	cancelPull: cancelPullThunk,
	pushSite: pushSiteThunk,
	pullSite: pullSiteThunk,
	pollPushProgress: pollPushProgressThunk,
	pollPullBackup: pollPullBackupThunk,
	initializeSyncStates: initializeSyncStatesThunk,
};

// Helper functions for checking state keys (matching useSyncStatesProgressInfo logic)
const isKeyPulling = ( key?: PullStateProgressInfo[ 'key' ] ): boolean => {
	if ( ! key ) {
		return false;
	}
	const keys = [ 'in-progress', 'downloading', 'importing' ];
	return keys.includes( key );
};

const isKeyPullingLocally = ( key?: PullStateProgressInfo[ 'key' ] ): boolean => {
	if ( ! key ) {
		return false;
	}
	const keys = [ 'downloading', 'importing' ];
	return keys.includes( key );
};

const isKeyUploading = ( key: PushStateProgressInfo[ 'key' ] | undefined ): boolean => {
	if ( ! key ) {
		return false;
	}
	const keys = [ 'creatingBackup', 'uploading', 'uploadingManuallyPaused' ];
	return keys.includes( key );
};

const isKeyPushing = ( key?: PushStateProgressInfo[ 'key' ] ): boolean => {
	if ( ! key ) {
		return false;
	}
	const keys = [
		'creatingBackup',
		'uploading',
		'creatingRemoteBackup',
		'applyingChanges',
		'finishing',
	];
	return keys.includes( key );
};

export const syncOperationsSelectors = {
	selectPullStates: ( state: { syncOperations: SyncOperationsState } ) =>
		state.syncOperations.pullStates,
	selectPushStates: ( state: { syncOperations: SyncOperationsState } ) =>
		state.syncOperations.pushStates,
	selectPullState:
		( selectedSiteId: string, remoteSiteId: number ) =>
		( state: { syncOperations: SyncOperationsState } ): SyncBackupState | undefined => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return state.syncOperations.pullStates[ stateId ] as SyncBackupState | undefined;
		},
	selectPushState:
		( selectedSiteId: string, remoteSiteId: number ) =>
		( state: { syncOperations: SyncOperationsState } ): SyncPushState | undefined => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return state.syncOperations.pushStates[ stateId ] as SyncPushState | undefined;
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
				if ( pullState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined && pullState.remoteSiteId !== remoteSiteId ) {
					return false;
				}
				return isKeyPulling( pullState.status.key );
			} );
		},
	selectIsSiteIdPullingLocally:
		( selectedSiteId?: string, remoteSiteId?: number ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return Object.values( state.syncOperations.pullStates ).some( ( pullState ) => {
				if ( pullState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined && pullState.remoteSiteId !== remoteSiteId ) {
					return false;
				}
				return isKeyPullingLocally( pullState.status.key );
			} );
		},
	selectIsAnySitePushing: ( state: { syncOperations: SyncOperationsState } ): boolean => {
		return Object.values( state.syncOperations.pushStates ).some( ( pushState ) =>
			isKeyPushing( pushState.status.key )
		);
	},
	selectIsSiteIdPushing:
		( selectedSiteId?: string, remoteSiteId?: number ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return Object.values( state.syncOperations.pushStates ).some( ( pushState ) => {
				if ( pushState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined && pushState.remoteSiteId !== remoteSiteId ) {
					return false;
				}
				return isKeyPushing( pushState.status.key );
			} );
		},
	selectIsSiteIdPushingLocally:
		( selectedSiteId?: string, remoteSiteId?: number ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return Object.values( state.syncOperations.pushStates ).some( ( pushState ) => {
				if ( pushState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined && pushState.remoteSiteId !== remoteSiteId ) {
					return false;
				}
				return isKeyUploading( pushState.status.key );
			} );
		},
	// "Local sync work" = the phases the local machine is actively involved in (pull
	// downloading/importing, push backup uploading). We can only block on these; the
	// server-bound phases of a sync continue regardless.
	selectIsSiteDoingLocalSyncWork:
		( selectedSiteId?: string, remoteSiteId?: number ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return (
				syncOperationsSelectors.selectIsSiteIdPullingLocally(
					selectedSiteId,
					remoteSiteId
				)( state ) ||
				syncOperationsSelectors.selectIsSiteIdPushingLocally(
					selectedSiteId,
					remoteSiteId
				)( state )
			);
		},
	selectIsAnySiteDoingLocalSyncWork: ( state: {
		syncOperations: SyncOperationsState;
	} ): boolean => {
		const anyPullLocal = Object.values( state.syncOperations.pullStates ).some( ( pullState ) =>
			isKeyPullingLocally( pullState.status.key )
		);
		const anyPushLocal = Object.values( state.syncOperations.pushStates ).some( ( pushState ) =>
			isKeyUploading( pushState.status.key )
		);
		return anyPullLocal || anyPushLocal;
	},
};
