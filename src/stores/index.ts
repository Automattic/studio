import {
	combineReducers,
	configureStore,
	createListenerMiddleware,
	isAnyOf,
} from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { LOCAL_STORAGE_CHAT_API_IDS_KEY, LOCAL_STORAGE_CHAT_MESSAGES_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import certificateTrustReducer from 'src/store/slices/certificate-trust';
import { appVersionApi } from 'src/stores/app-version-api';
import { reducer as chatReducer } from 'src/stores/chat-slice';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { reducer as newSitesReducer } from 'src/stores/new-sites-slice';
import { reducer as snapshotReducer, updateSnapshotLocally } from 'src/stores/snapshot-slice';
import { wpcomApi } from 'src/stores/wpcom-api';
import { wordpressVersionsApi } from './wordpress-versions-api';

export type RootState = {
	appVersionApi: ReturnType< typeof appVersionApi.reducer >;
	chat: ReturnType< typeof chatReducer >;
	newSites: ReturnType< typeof newSitesReducer >;
	installedAppsApi: ReturnType< typeof installedAppsApi.reducer >;
	snapshot: ReturnType< typeof snapshotReducer >;
	wordpressVersionsApi: ReturnType< typeof wordpressVersionsApi.reducer >;
	wpcomApi: ReturnType< typeof wpcomApi.reducer >;
	certificateTrust: ReturnType< typeof certificateTrustReducer >;
};

const listenerMiddleware = createListenerMiddleware< RootState >();

// Save chat messages to local storage
listenerMiddleware.startListening( {
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

// Save chat API IDs to local storage
listenerMiddleware.startListening( {
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

// Save snapshots to user config
listenerMiddleware.startListening( {
	matcher: isAnyOf( updateSnapshotLocally ),
	async effect( action, listenerApi ) {
		const state = listenerApi.getState();
		await getIpcApi().saveSnapshotsToStorage( state.snapshot.snapshots );
	},
} );

export const rootReducer = combineReducers( {
	appVersionApi: appVersionApi.reducer,
	chat: chatReducer,
	newSites: newSitesReducer,
	installedAppsApi: installedAppsApi.reducer,
	snapshot: snapshotReducer,
	wordpressVersionsApi: wordpressVersionsApi.reducer,
	wpcomApi: wpcomApi.reducer,
	certificateTrust: certificateTrustReducer,
} );

export const store = configureStore( {
	reducer: rootReducer,
	middleware: ( getDefaultMiddleware ) =>
		getDefaultMiddleware()
			.prepend( listenerMiddleware.middleware )
			.concat( appVersionApi.middleware )
			.concat( installedAppsApi.middleware )
			.concat( wordpressVersionsApi.middleware )
			.concat( wpcomApi.middleware ),
} );

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch< AppDispatch >();
export const useRootSelector = < T >( selector: ( state: RootState ) => T ) =>
	useSelector( selector );
