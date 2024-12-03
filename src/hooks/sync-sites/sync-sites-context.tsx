import React, { createContext, useContext, useEffect, useState } from 'react';
import { SyncSite } from '../use-fetch-wpcom-sites';
import { usePullPushTimestamps } from '../use-pull-push-timestamps';
import { useSiteDetails } from '../use-site-details';
import { useListenDeepLinkConnection } from './use-listen-deep-link-connection';
import { useSiteSyncManagement } from './use-site-sync-management';
import { PullStates, useSyncPull } from './use-sync-pull';
import { PushStates, useSyncPush } from './use-sync-push';

export type SyncSitesContextType = ReturnType< typeof useSyncPull > &
	ReturnType< typeof useSyncPush > &
	ReturnType< typeof useSiteSyncManagement > &
	ReturnType< typeof usePullPushTimestamps >;

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const [ pullStates, setPullStates ] = useState< PullStates >( {} );
	const {
		clearPullState,
		getPullState,
		hydratePullStates,
		isAnySitePulling,
		isSiteIdPulling,
		pullSite,
		updatePullState,
	} = useSyncPull( {
		pullStates,
		setPullStates,
	} );

	const [ pushStates, setPushStates ] = useState< PushStates >( {} );
	const { clearPushState, getPushState, isAnySitePushing, isSiteIdPushing, pushSite } = useSyncPush(
		{
			pushStates,
			setPushStates,
		}
	);

	const [ triggerPullStatesHydration, setTriggerPullStatesHydration ] = useState( '' );
	const { selectedSite } = useSiteDetails();

	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const { connectSite, disconnectSite, syncSites, isFetching, refetchSites } =
		useSiteSyncManagement( {
			connectedSites,
			onConnectedSitesLoaded( connectedSites, siteId ) {
				// Instead of calling `hydratePullStates` directly, we trigger a state update. Why?
				// Because the functions in this hook have complex dependencies, and
				// `hydratePullStates` would not have access to the latest values for its closure
				// members if we called it directly from within this function.
				setTriggerPullStatesHydration( siteId );
			},
			pullStates,
			setConnectedSites,
		} );

	useEffect( () => {
		if ( triggerPullStatesHydration && selectedSite ) {
			hydratePullStates( connectedSites, selectedSite );
		}
	}, [ connectedSites, hydratePullStates, selectedSite, triggerPullStatesHydration ] );

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
