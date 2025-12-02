import {
	combineReducers,
	configureStore,
	createListenerMiddleware,
	isAnyOf,
} from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector } from 'react-redux';
import { LOCAL_STORAGE_CHAT_API_IDS_KEY, LOCAL_STORAGE_CHAT_MESSAGES_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { appVersionApi } from 'src/stores/app-version-api';
import { betaFeaturesReducer, loadBetaFeatures } from 'src/stores/beta-features-slice';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import { reducer as chatReducer } from 'src/stores/chat-slice';
import i18nReducer from 'src/stores/i18n-slice';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import onboardingReducer from 'src/stores/onboarding-slice';
import providerConstantsReducer, {
	setProviderConstants,
} from 'src/stores/provider-constants-slice';
import {
	reducer as snapshotReducer,
	updateSnapshotLocally,
	snapshotActions,
} from 'src/stores/snapshot-slice';
import { syncReducer } from 'src/stores/sync';
import { connectedSitesApi, connectedSitesReducer } from 'src/stores/sync/connected-sites';
import { wpcomSitesApi } from 'src/stores/sync/wpcom-sites';
import { wpcomApi, wpcomPublicApi } from 'src/stores/wpcom-api';
import { wordpressVersionsApi } from './wordpress-versions-api';
import type { SupportedLocale } from 'common/lib/locale';

export type RootState = {
	appVersionApi: ReturnType< typeof appVersionApi.reducer >;
	betaFeatures: ReturnType< typeof betaFeaturesReducer >;
	chat: ReturnType< typeof chatReducer >;
	installedAppsApi: ReturnType< typeof installedAppsApi.reducer >;
	onboarding: ReturnType< typeof onboardingReducer >;
	providerConstants: ReturnType< typeof providerConstantsReducer >;
	snapshot: ReturnType< typeof snapshotReducer >;
	sync: ReturnType< typeof syncReducer >;
	connectedSitesApi: ReturnType< typeof connectedSitesApi.reducer >;
	connectedSites: ReturnType< typeof connectedSitesReducer >;
	wpcomSitesApi: ReturnType< typeof wpcomSitesApi.reducer >;
	wordpressVersionsApi: ReturnType< typeof wordpressVersionsApi.reducer >;
	wpcomApi: ReturnType< typeof wpcomApi.reducer >;
	wpcomPublicApi: ReturnType< typeof wpcomPublicApi.reducer >;
	certificateTrustApi: ReturnType< typeof certificateTrustApi.reducer >;
	i18n: ReturnType< typeof i18nReducer >;
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
	matcher: isAnyOf( updateSnapshotLocally, snapshotActions.deleteSnapshotLocally ),
	async effect( action, listenerApi ) {
		const state = listenerApi.getState();
		await getIpcApi().saveSnapshotsToStorage( state.snapshot.snapshots );
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
	providerConstants: providerConstantsReducer,
	snapshot: snapshotReducer,
	sync: syncReducer,
	wordpressVersionsApi: wordpressVersionsApi.reducer,
	wpcomApi: wpcomApi.reducer,
	wpcomPublicApi: wpcomPublicApi.reducer,
	certificateTrustApi: certificateTrustApi.reducer,
	i18n: i18nReducer,
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

// Listen for provider constants changes
window.addEventListener( 'providerConstantsChanged', ( event: Event ) => {
	const customEvent = event as CustomEvent;
	store.dispatch( setProviderConstants( customEvent.detail ) );
} );

// Initialize provider constants when store is ready
async function initializeProviderConstants() {
	try {
		const constants = await getIpcApi().getProviderConstants();
		store.dispatch( setProviderConstants( constants ) );
	} catch ( error ) {
		console.error( 'Error initializing provider constants:', error );
	}
}

// Initialize provider constants immediately, but skip in test environment
if ( typeof jest === 'undefined' && process.env.NODE_ENV !== 'test' ) {
	void initializeProviderConstants();
	// Initialize beta features on store initialization only in non-test environment
	void store.dispatch( loadBetaFeatures() );
}

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch< AppDispatch >();
export const useRootSelector = < T >( selector: ( state: RootState ) => T ) =>
	useSelector( selector );

export const useI18nLocale = (): SupportedLocale =>
	useRootSelector( ( state: RootState ) => state.i18n.locale );
