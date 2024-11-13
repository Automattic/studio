import React, { createContext, useContext, useState } from 'react';
import { SyncSite } from '../use-fetch-wpcom-sites';
import { SyncBackupState, useSyncPull } from './use-sync-pull';

type SyncSitesContextType = {
	pullStates: Record< number, SyncBackupState >;
	pullSite: ( connectedSite: SyncSite, selectedSite: SiteDetails ) => Promise< void >;
	isAnySitePulling: boolean;
	isSiteIdPulling: ( selectedSiteId: string ) => boolean;
	clearPullState: ( remoteSiteId: number ) => void;
};

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const [ pullStates, setPullStates ] = useState< Record< number, SyncBackupState > >( {} );
	const { pullSite, isAnySitePulling, isSiteIdPulling, clearPullState } = useSyncPull( {
		pullStates,
		setPullStates,
	} );

	return (
		<SyncSitesContext.Provider
			value={ { pullStates, pullSite, isAnySitePulling, isSiteIdPulling, clearPullState } }
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
