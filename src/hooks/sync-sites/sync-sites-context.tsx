import React, { createContext, useContext } from 'react';
import { PullStateProgressInfo } from '../use-sync-states-progress-info';
import { useSyncPull } from './use-sync-pull';

export type SiteBackupState = {
	backupId: string | null;
	status: PullStateProgressInfo;
	downloadUrl: string | null;
	selectedSite: SiteDetails;
};

type SyncSitesContextType = {
	pullStates: Record< number, SiteBackupState >;
	pullSite: ( remoteSiteId: number, selectedSite: SiteDetails ) => Promise< void >;
	isAnySitePulling: boolean;
};

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const { pullStates, pullSite, isAnySitePulling } = useSyncPull();

	return (
		<SyncSitesContext.Provider value={ { pullStates, pullSite, isAnySitePulling } }>
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
