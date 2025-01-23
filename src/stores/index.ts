import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { CHAT_ID_STORE_KEY, CHAT_MESSAGES_STORE_KEY } from 'src/constants';
import chatReducer from 'src/stores/chat-slice';

export type RootState = {
	chat: ReturnType< typeof chatReducer >;
};

const listenerMiddleware = createListenerMiddleware< RootState >();

listenerMiddleware.startListening( {
	predicate( action, currentState, previousState ) {
		return currentState.chat.messagesDict !== previousState.chat.messagesDict;
	},
	effect( action, listenerApi ) {
		const state = listenerApi.getState() as RootState;
		localStorage.setItem( CHAT_MESSAGES_STORE_KEY, JSON.stringify( state.chat.messagesDict ) );
	},
} );

listenerMiddleware.startListening( {
	predicate( action, currentState, previousState ) {
		return currentState.chat.chatApiIdDict !== previousState.chat.chatApiIdDict;
	},
	effect( action, listenerApi ) {
		const state = listenerApi.getState() as RootState;
		localStorage.setItem( CHAT_ID_STORE_KEY, JSON.stringify( state.chat.chatApiIdDict ) );
	},
} );

const store = configureStore( {
	reducer: {
		chat: chatReducer,
	},
	middleware: ( getDefaultMiddleware ) =>
		getDefaultMiddleware().prepend( listenerMiddleware.middleware ),
} );

export default store;

export type AppDispatch = typeof store.dispatch;
