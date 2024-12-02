import React, { createContext, useContext } from 'react';
import { usePullPushTimestamps } from '../use-pull-push-timestamps';
import { useListenDeepLinkConnection } from './use-listen-deep-link-connection';
import { useSiteSyncManagement } from './use-site-sync-management';
import { useSyncPull } from './use-sync-pull';
import { useSyncPush } from './use-sync-push';

export type SyncSitesContextType = ReturnType< typeof useSyncPull > &
	ReturnType< typeof useSyncPush > &
	ReturnType< typeof useSiteSyncManagement > &
	ReturnType< typeof usePullPushTimestamps >;

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const {
		clearPullState,
		getPullState,
		hydratePullStates,
		isAnySitePulling,
		isSiteIdPulling,
		pullSite,
		pullStates,
		updatePullState,
	} = useSyncPull();

	const { clearPushState, getPushState, isAnySitePushing, isSiteIdPushing, pushSite, pushStates } =
		useSyncPush();

	const { connectedSites, connectSite, disconnectSite, syncSites, isFetching, refetchSites } =
		useSiteSyncManagement( {
			onConnectedSitesLoaded( connectedSites, site ) {
				hydratePullStates( connectedSites, site );
			},
			pullStates,
		} );

	const { updateTimestamp, getLastSyncTimeWithType, clearTimestamps } = usePullPushTimestamps();

	useListenDeepLinkConnection( { connectSite, refetchSites } );

	return (
		<SyncSitesContext.Provider
			value={ {
				pullStates,
				pullSite,
				isAnySitePulling,
				isSiteIdPulling,
				clearPullState,
				connectedSites,
				connectSite,
				disconnectSite,
				syncSites,
				refetchSites,
				isFetching,
				pushStates,
				getPullState,
				getPushState,
				pushSite,
				isAnySitePushing,
				isSiteIdPushing,
				clearPushState,
				updateTimestamp,
				getLastSyncTimeWithType,
				clearTimestamps,
				hydratePullStates,
				updatePullState,
			} }
		>
			{ children }
		</SyncSitesContext.Provider>
	);
}

export function useSyncSites() {
	const context = useContext( SyncSitesContext );
	if ( context === undefined ) {
		throw new Error( 'useSyncSites must be used within a SyncSitesProvider' );
	}
	return context;
}
