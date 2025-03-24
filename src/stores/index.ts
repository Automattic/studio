import { combineReducers, configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { LOCAL_STORAGE_CHAT_API_IDS_KEY, LOCAL_STORAGE_CHAT_MESSAGES_KEY } from 'src/constants';
import { reducer as chatReducer } from 'src/stores/chat-slice';
import {
	reducer as wordpressVersionsReducer,
	wordpressVersionsThunks,
} from 'src/stores/wordpress-versions-slice';
import { wpcomApi } from 'src/stores/wpcom-api';

export type RootState = {
	chat: ReturnType< typeof chatReducer >;
	wordpressVersions: ReturnType< typeof wordpressVersionsReducer >;
	wpcomApi: ReturnType< typeof wpcomApi.reducer >;
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

export const rootReducer = combineReducers( {
	chat: chatReducer,
	wordpressVersions: wordpressVersionsReducer,
	wpcomApi: wpcomApi.reducer,
} );

export const store = configureStore( {
	reducer: rootReducer,
	middleware: ( getDefaultMiddleware ) =>
		getDefaultMiddleware().prepend( listenerMiddleware.middleware ).concat( wpcomApi.middleware ),
} );

store.dispatch( wordpressVersionsThunks.fetchWordPressVersions() );

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch< AppDispatch >();
export const useRootSelector = < T >( selector: ( state: RootState ) => T ) =>
	useSelector( selector );
