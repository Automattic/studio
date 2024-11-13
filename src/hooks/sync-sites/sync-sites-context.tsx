import React, { createContext, useContext, useState } from 'react';
import { useSyncPull } from './use-sync-pull';

type SyncSitesContextType = ReturnType< typeof useSyncPull >;

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const [ pullStates, setPullStates ] = useState< SyncSitesContextType[ 'pullStates' ] >( {} );
	const { pullSite, isAnySitePulling, isSiteIdPulling, clearPullState, getPullState } = useSyncPull(
		{
			pullStates,
			setPullStates,
		}
	);

	return (
		<SyncSitesContext.Provider
			value={ {
				pullStates,
				pullSite,
				isAnySitePulling,
				isSiteIdPulling,
				clearPullState,
				getPullState,
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
