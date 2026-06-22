import { combineReducers, configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector } from 'react-redux';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { appVersionApi } from 'src/stores/app-version-api';
import { userLoggedOut } from 'src/stores/auth-actions';
import { betaFeaturesReducer, loadBetaFeatures } from 'src/stores/beta-features-slice';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
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
	abortAllSyncOperations,
	stopPullPoller,
	stopPushPoller,
	syncOperationsReducer,
	syncOperationsThunks,
} from 'src/stores/sync/sync-operations-slice';
import { wpcomSitesApi } from 'src/stores/sync/wpcom-sites';
import uiReducer from 'src/stores/ui-slice';
import { setWpcomClient, wpcomApi, wpcomPublicApi } from 'src/stores/wpcom-api';
import { wordpressVersionsApi } from './wordpress-versions-api';
import type { SupportedLocale } from '@studio/common/lib/locale';

export type RootState = {
	appVersionApi: ReturnType< typeof appVersionApi.reducer >;
	betaFeatures: ReturnType< typeof betaFeaturesReducer >;
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
	i18n: ReturnType< typeof i18nReducer >;
	ui: ReturnType< typeof uiReducer >;
};

const listenerMiddleware = createListenerMiddleware();
const startAppListening = listenerMiddleware.startListening.withTypes< RootState, AppDispatch >();

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

// Clear all sync state when user logs out. Slice state is reset via
// addCase(userLoggedOut) in sync-operations-slice; here we only abort the
// in-flight side effects (pollers, upload aborts, main-process operations) so
// they don't surface error UI after logout.
startAppListening( {
	actionCreator: userLoggedOut,
	effect( action, listenerApi ) {
		setWpcomClient( undefined );

		abortAllSyncOperations();

		listenerApi.dispatch( wpcomSitesApi.util.resetApiState() );
		listenerApi.dispatch( wpcomApi.util.resetApiState() );
	},
} );

export const rootReducer = combineReducers( {
	appVersionApi: appVersionApi.reducer,
	betaFeatures: betaFeaturesReducer,
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

// Initialize beta features and fetch snapshots on store initialization, but skip in test environment
if ( process.env.NODE_ENV !== 'test' ) {
	void store.dispatch( loadBetaFeatures() );
	void refreshSnapshots();
}

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch< AppDispatch >();
export const useRootSelector = < T >( selector: ( state: RootState ) => T ) =>
	useSelector( selector );

export const useI18nLocale = (): SupportedLocale =>
	useRootSelector( ( state: RootState ) => state.i18n.locale );
