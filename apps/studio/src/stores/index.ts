import { combineReducers, configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector } from 'react-redux';
import {
	LOCAL_STORAGE_CHAT_API_IDS_KEY,
	LOCAL_STORAGE_CHAT_MESSAGES_KEY,
	LOCAL_STORAGE_TASK_MESSAGES_KEY,
} from 'src/constants';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { appVersionApi } from 'src/stores/app-version-api';
import { betaFeaturesReducer, loadBetaFeatures } from 'src/stores/beta-features-slice';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import { reducer as chatReducer } from 'src/stores/chat-slice';
import i18nReducer from 'src/stores/i18n-slice';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import onboardingReducer from 'src/stores/onboarding-slice';
import {
	reducer as snapshotReducer,
	refreshSnapshots,
	snapshotActions,
} from 'src/stores/snapshot-slice';
import { syncReducer, syncOperationsActions } from 'src/stores/sync';
import { connectedSitesApi, connectedSitesReducer } from 'src/stores/sync/connected-sites';
import {
	syncOperationsReducer,
	syncOperationsSelectors,
	syncOperationsThunks,
} from 'src/stores/sync/sync-operations-slice';
import { wpcomSitesApi } from 'src/stores/sync/wpcom-sites';
import {
	tasksReducer,
	loadTasks,
	taskUpdatedFromMain,
	taskDeletedFromMain,
	appendTaskMessage,
	setTaskStatus,
	setTaskStreaming,
	addPermissionRequest,
	addQuestionRequest,
	dequeueMessage,
} from 'src/stores/tasks-slice';
import uiReducer from 'src/stores/ui-slice';
import { getWpcomClient, wpcomApi, wpcomPublicApi } from 'src/stores/wpcom-api';
import { wordpressVersionsApi } from './wordpress-versions-api';
import type { SupportedLocale } from '@studio/common/lib/locale';

export type RootState = {
	appVersionApi: ReturnType< typeof appVersionApi.reducer >;
	betaFeatures: ReturnType< typeof betaFeaturesReducer >;
	chat: ReturnType< typeof chatReducer >;
	installedAppsApi: ReturnType< typeof installedAppsApi.reducer >;
	onboarding: ReturnType< typeof onboardingReducer >;
	snapshot: ReturnType< typeof snapshotReducer >;
	sync: ReturnType< typeof syncReducer >;
	connectedSitesApi: ReturnType< typeof connectedSitesApi.reducer >;
	connectedSites: ReturnType< typeof connectedSitesReducer >;
	syncOperations: ReturnType< typeof syncOperationsReducer >;
	wpcomSitesApi: ReturnType< typeof wpcomSitesApi.reducer >;
	wordpressVersionsApi: ReturnType< typeof wordpressVersionsApi.reducer >;
	wpcomApi: ReturnType< typeof wpcomApi.reducer >;
	wpcomPublicApi: ReturnType< typeof wpcomPublicApi.reducer >;
	certificateTrustApi: ReturnType< typeof certificateTrustApi.reducer >;
	tasks: ReturnType< typeof tasksReducer >;
	i18n: ReturnType< typeof i18nReducer >;
	ui: ReturnType< typeof uiReducer >;
};

const listenerMiddleware = createListenerMiddleware();
const startAppListening = listenerMiddleware.startListening.withTypes< RootState, AppDispatch >();

// Save chat messages to local storage
startAppListening( {
	predicate( action, currentState, previousState ) {
		return currentState.chat.messagesDict !== previousState.chat.messagesDict;
	},
	effect( action, listenerApi ) {
		const state = listenerApi.getState();
		localStorage.setItem(
			LOCAL_STORAGE_CHAT_MESSAGES_KEY,
			JSON.stringify( state.chat.messagesDict )
		);
	},
} );

// Save task messages to local storage
startAppListening( {
	predicate( action, currentState, previousState ) {
		return currentState.tasks.messagesByTask !== previousState.tasks.messagesByTask;
	},
	effect( action, listenerApi ) {
		const state = listenerApi.getState();
		localStorage.setItem(
			LOCAL_STORAGE_TASK_MESSAGES_KEY,
			JSON.stringify( state.tasks.messagesByTask )
		);
	},
} );

// Save chat API IDs to local storage
startAppListening( {
	predicate( action, currentState, previousState ) {
		return currentState.chat.chatApiIdDict !== previousState.chat.chatApiIdDict;
	},
	effect( action, listenerApi ) {
		const state = listenerApi.getState();
		localStorage.setItem(
			LOCAL_STORAGE_CHAT_API_IDS_KEY,
			JSON.stringify( state.chat.chatApiIdDict )
		);
	},
} );

// Save snapshot changes to CLI config via preview set command
startAppListening( {
	actionCreator: snapshotActions.updateSnapshotLocally,
	async effect( action, listenerApi ) {
		const state = listenerApi.getState();
		const snapshot = state.snapshot.snapshots.find(
			( snapshot ) => snapshot.atomicSiteId === action.payload.atomicSiteId
		);

		if ( snapshot && snapshot.name ) {
			await getIpcApi().setSnapshot( snapshot.url, { name: snapshot.name } );
		}
	},
} );

const TERMINAL_STATUS_KEYS = [ 'failed', 'finished', 'cancelled' ];

// Sync push/pull state updates to IPC (addSyncOperation / clearSyncOperation)
function keepSyncOperationInSync(
	stateId: string,
	status?: PushStateProgressInfo | PullStateProgressInfo
) {
	if ( status?.key && TERMINAL_STATUS_KEYS.includes( status.key ) ) {
		getIpcApi().clearSyncOperation( stateId );
	} else if ( status ) {
		getIpcApi().addSyncOperation( stateId, status );
	}
}
startAppListening( {
	actionCreator: syncOperationsActions.updatePushState,
	effect( action ) {
		const { selectedSiteId, remoteSiteId, state } = action.payload;
		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		keepSyncOperationInSync( stateId, state.status );
	},
} );
startAppListening( {
	actionCreator: syncOperationsActions.updatePullState,
	effect( action ) {
		const { selectedSiteId, remoteSiteId, state } = action.payload;
		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		keepSyncOperationInSync( stateId, state.status );
	},
} );

// Sync push/pull state clears to IPC (clearSyncOperation)
startAppListening( {
	actionCreator: syncOperationsActions.clearPushState,
	effect( action ) {
		const { selectedSiteId, remoteSiteId } = action.payload;
		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		stopPushPoller( stateId );
		getIpcApi().clearSyncOperation( stateId );
	},
} );
startAppListening( {
	actionCreator: syncOperationsActions.clearPullState,
	effect( action ) {
		const { selectedSiteId, remoteSiteId } = action.payload;
		const stateId = generateStateId( selectedSiteId, remoteSiteId );
		stopPullPoller( stateId );
		getIpcApi().clearSyncOperation( stateId );
	},
} );

// Show error modals for rejected sync thunks
function maybeShowErrorMessageBox(
	params: { title: string; message: string; error?: unknown; showOpenLogs?: boolean } | undefined,
	aborted: boolean
) {
	if ( params && ! aborted ) {
		getIpcApi().showErrorMessageBox( params );
	}
}
startAppListening( {
	actionCreator: syncOperationsThunks.pushSite.rejected,
	effect( action ) {
		maybeShowErrorMessageBox( action.payload, action.meta.aborted );
	},
} );
startAppListening( {
	actionCreator: syncOperationsThunks.pullSite.rejected,
	effect( action ) {
		maybeShowErrorMessageBox( action.payload, action.meta.aborted );
	},
} );
startAppListening( {
	actionCreator: syncOperationsThunks.pollPushProgress.rejected,
	effect( action ) {
		maybeShowErrorMessageBox( action.payload, action.meta.aborted );
	},
} );
startAppListening( {
	actionCreator: syncOperationsThunks.pollPullBackup.rejected,
	effect( action ) {
		maybeShowErrorMessageBox( action.payload, action.meta.aborted );
	},
} );

const PUSH_POLLING_KEYS = [ 'creatingRemoteBackup', 'applyingChanges', 'finishing' ];
const SYNC_POLLING_INTERVAL = 3000;

const PUSH_POLLERS = new Map< string, AbortController >();
const PULL_POLLERS = new Map< string, AbortController >();

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

function stopPushPoller( stateId: string ) {
	PUSH_POLLERS.get( stateId )?.abort();
	PUSH_POLLERS.delete( stateId );
}

function stopPullPoller( stateId: string ) {
	PULL_POLLERS.get( stateId )?.abort();
	PULL_POLLERS.delete( stateId );
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
				syncOperationsThunks.pollPushProgress( {
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
				syncOperationsThunks.pollPullBackup( {
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

// Poll push progress when state enters a pollable status
startAppListening( {
	actionCreator: syncOperationsActions.updatePushState,
	effect( action ) {
		const { selectedSiteId, remoteSiteId } = action.payload;
		const stateId = generateStateId( selectedSiteId, remoteSiteId );

		if ( isPushPollable( selectedSiteId, remoteSiteId ) ) {
			void startPushPoller( selectedSiteId, remoteSiteId );
		} else {
			stopPushPoller( stateId );
		}
	},
} );

// Poll pull backup when state has a backupId and is in-progress
startAppListening( {
	actionCreator: syncOperationsActions.updatePullState,
	effect( action ) {
		const { selectedSiteId, remoteSiteId } = action.payload;
		const stateId = generateStateId( selectedSiteId, remoteSiteId );

		if ( isPullPollable( selectedSiteId, remoteSiteId ) ) {
			void startPullPoller( selectedSiteId, remoteSiteId );
		} else {
			stopPullPoller( stateId );
		}
	},
} );

export const rootReducer = combineReducers( {
	appVersionApi: appVersionApi.reducer,
	betaFeatures: betaFeaturesReducer,
	chat: chatReducer,
	installedAppsApi: installedAppsApi.reducer,
	connectedSitesApi: connectedSitesApi.reducer,
	connectedSites: connectedSitesReducer,
	wpcomSitesApi: wpcomSitesApi.reducer,
	onboarding: onboardingReducer,
	snapshot: snapshotReducer,
	sync: syncReducer,
	syncOperations: syncOperationsReducer,
	wordpressVersionsApi: wordpressVersionsApi.reducer,
	wpcomApi: wpcomApi.reducer,
	wpcomPublicApi: wpcomPublicApi.reducer,
	certificateTrustApi: certificateTrustApi.reducer,
	tasks: tasksReducer,
	i18n: i18nReducer,
	ui: uiReducer,
} );

export const store = configureStore( {
	reducer: rootReducer,
	middleware: ( getDefaultMiddleware ) =>
		getDefaultMiddleware()
			.prepend( listenerMiddleware.middleware )
			.concat( appVersionApi.middleware )
			.concat( installedAppsApi.middleware )
			.concat( connectedSitesApi.middleware )
			.concat( wpcomSitesApi.middleware )
			.concat( wordpressVersionsApi.middleware )
			.concat( wpcomApi.middleware )
			.concat( wpcomPublicApi.middleware )
			.concat( certificateTrustApi.middleware ),
} );

// Enable the refetchOnFocus behavior
setupListeners( store.dispatch );

// Listen for task events from main process
if ( typeof window !== 'undefined' && window.ipcListener ) {
	window.ipcListener.subscribe( 'task-updated', ( _, task ) => {
		store.dispatch( taskUpdatedFromMain( task ) );
	} );
	window.ipcListener.subscribe( 'task-deleted', ( _, taskId ) => {
		store.dispatch( taskDeletedFromMain( taskId ) );
	} );
	window.ipcListener.subscribe( 'task-message', ( _, { taskId, message } ) => {
		store.dispatch( appendTaskMessage( { taskId, message } ) );
	} );
	window.ipcListener.subscribe( 'task-status-changed', ( _, { taskId, status } ) => {
		store.dispatch(
			setTaskStatus( {
				taskId,
				status: status as import('src/modules/ai/types').TaskStatus,
			} )
		);
		// Clear streaming when the agent turn completes
		if ( status === 'waiting' || status === 'done' ) {
			store.dispatch( setTaskStreaming( { taskId, streaming: false } ) );
		}
		// Generate summary after first agent turn completes
		if ( status === 'waiting' ) {
			const state = store.getState();
			const task = state.tasks.tasks.find( ( t ) => t.id === taskId );
			if ( task && ! task.summary ) {
				const messages = state.tasks.messagesByTask[ taskId ] ?? [];
				const firstUserMsg = messages.find( ( m ) => m.role === 'user' );
				const firstAssistantMsg = messages.find( ( m ) => m.role === 'assistant' );
				if ( firstUserMsg ) {
					void getIpcApi().generateTaskSummary( taskId, {
						title: task.title,
						firstMessage: firstUserMsg.content,
						firstResponse: firstAssistantMsg?.content,
					} );
				}
			}

			// Auto-send next queued message
			const currentState = store.getState();
			const messages = currentState.tasks.messagesByTask[ taskId ] ?? [];
			const lastMessage = messages[ messages.length - 1 ];
			if ( lastMessage?.isError ) {
				return; // Don't auto-send after errors
			}
			const queue = currentState.tasks.queuedMessagesByTask[ taskId ];
			if ( queue && queue.length > 0 ) {
				const next = queue[ 0 ];
				store.dispatch( dequeueMessage( { taskId, messageId: next.id } ) );

				// Build content description for display
				const parts: string[] = [];
				if ( next.images?.length ) {
					parts.push( `${ next.images.length } image${ next.images.length > 1 ? 's' : '' }` );
				}
				if ( next.elements?.length ) {
					parts.push( `${ next.elements.length } element${ next.elements.length > 1 ? 's' : '' }` );
				}

				const userMessage = {
					id: `user-${ Date.now() }`,
					role: 'user' as const,
					content: next.text || ( parts.length > 0 ? `[Attached ${ parts.join( ' and ' ) }]` : '' ),
					timestamp: Date.now(),
					...( next.images?.length && { images: next.images } ),
					...( next.elements?.length && { elements: next.elements } ),
				};
				store.dispatch( appendTaskMessage( { taskId, message: userMessage } ) );
				store.dispatch( setTaskStreaming( { taskId, streaming: true } ) );
				void getIpcApi().sendTaskMessageHandler( taskId, next.text, next.images, next.elements );
			}
		}
	} );
	window.ipcListener.subscribe( 'task-permission-request', ( _, request ) => {
		store.dispatch( addPermissionRequest( request ) );
	} );
	window.ipcListener.subscribe( 'task-question-request', ( _, request ) => {
		store.dispatch( addQuestionRequest( request ) );
	} );
	window.ipcListener.subscribe( 'task-error', ( _, { taskId, error } ) => {
		store.dispatch(
			appendTaskMessage( {
				taskId,
				message: {
					id: `error-${ Date.now() }`,
					role: 'system',
					content: error,
					timestamp: Date.now(),
					isError: true,
				},
			} )
		);
		store.dispatch( setTaskStreaming( { taskId, streaming: false } ) );
	} );

	// Listen for browser control commands from the agent
	window.ipcListener.subscribe( 'browser-navigate', ( _, { siteId, url } ) => {
		window.dispatchEvent(
			new CustomEvent( 'studio:browser-navigate', { detail: { siteId, url } } )
		);
	} );

	window.ipcListener.subscribe( 'browser-reload', ( _, { siteId } ) => {
		window.dispatchEvent( new CustomEvent( 'studio:browser-reload', { detail: { siteId } } ) );
	} );
}

// Initialize beta features and fetch snapshots on store initialization, but skip in test environment
if ( process.env.NODE_ENV !== 'test' ) {
	void store.dispatch( loadBetaFeatures() );
	void store.dispatch( loadTasks() );
	void refreshSnapshots();
}

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch< AppDispatch >();
export const useRootSelector = < T >( selector: ( state: RootState ) => T ) =>
	useSelector( selector );

export const useI18nLocale = (): SupportedLocale =>
	useRootSelector( ( state: RootState ) => state.i18n.locale );
