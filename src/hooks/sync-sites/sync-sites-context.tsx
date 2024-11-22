import React, { createContext, useContext, useState } from 'react';
import { SyncSite } from '../use-fetch-wpcom-sites';
import { usePullPushTimestamps } from '../use-pull-push-timestamps';
import { useSiteSyncManagement } from './use-site-sync-management';
import { useSyncPull } from './use-sync-pull';
import { useSyncPush } from './use-sync-push';

type SyncSitesContextType = ReturnType< typeof useSyncPull > &
	ReturnType< typeof useSyncPush > &
	ReturnType< typeof useSiteSyncManagement > &
	ReturnType< typeof usePullPushTimestamps >;

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const [ pullStates, setPullStates ] = useState< SyncSitesContextType[ 'pullStates' ] >( {} );
	const { pullSite, isAnySitePulling, isSiteIdPulling, clearPullState, getPullState } = useSyncPull(
		{
			pullStates,
			setPullStates,
		}
	);

	const [ pushStates, setPushStates ] = useState< SyncSitesContextType[ 'pushStates' ] >( {} );
	const { pushSite, isAnySitePushing, isSiteIdPushing, clearPushState, getPushState } = useSyncPush(
		{
			pushStates,
			setPushStates,
		}
	);

	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const { loadConnectedSites, connectSite, disconnectSite, syncSites, isFetching, refetchSites } =
		useSiteSyncManagement( { connectedSites, setConnectedSites } );

	const { updateTimestamp, getLastSyncTimeWithType, clearTimestamps } = usePullPushTimestamps();

	return (
		<SyncSitesContext.Provider
			value={ {
				pullStates,
				pullSite,
				isAnySitePulling,
				isSiteIdPulling,
				clearPullState,
				connectedSites,
				loadConnectedSites,
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
