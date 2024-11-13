import React, { createContext, useContext, useState } from 'react';
import { SyncSite } from '../use-fetch-wpcom-sites';
import { PullStateProgressInfo } from '../use-sync-states-progress-info';
import { useSiteSyncManagement } from './use-site-sync-management';
import { useSyncPull } from './use-sync-pull';

export type SiteBackupState = {
	backupId: string | null;
	status: PullStateProgressInfo;
	downloadUrl: string | null;
	selectedSite: SiteDetails;
	isStaging: boolean;
};

type SyncSitesContextType = ReturnType< typeof useSyncPull > &
	ReturnType< typeof useSiteSyncManagement >;

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const [ pullStates, setPullStates ] = useState< Record< number, SiteBackupState > >( {} );
	const { pullSite, isAnySitePulling, isSiteIdPulling, clearPullState } = useSyncPull( {
		pullStates,
		setPullStates,
	} );

	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const { loadConnectedSites, connectSite, disconnectSite, syncSites, isFetching } =
		useSiteSyncManagement( { connectedSites, setConnectedSites } );

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
				isFetching,
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
