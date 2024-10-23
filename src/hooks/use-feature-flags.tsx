import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { getAppGlobals } from '../lib/app-globals';
import { useAuth } from './use-auth';

export interface FeatureFlagsContextType {
	terminalWpCliEnabled: boolean;
	siteSyncEnabled: boolean;
}

export const FeatureFlagsContext = createContext< FeatureFlagsContextType >( {
	terminalWpCliEnabled: false,
	siteSyncEnabled: false,
} );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const terminalWpCliEnabledFromGlobals = getAppGlobals().terminalWpCliEnabled;
	const siteSyncEnabledFromGlobals = getAppGlobals().siteSyncEnabled;
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( {
		terminalWpCliEnabled: terminalWpCliEnabledFromGlobals,
		siteSyncEnabled: siteSyncEnabledFromGlobals,
	} );
	const { isAuthenticated, client } = useAuth();

	useEffect( () => {
		let cancel = false;
		async function loadFeatureFlags() {
			if ( ! isAuthenticated || ! client ) {
				return;
			}
			try {
				const flags = await client.req.get( {
					path: '/studio-app/feature-flags',
					apiNamespace: 'wpcom/v2',
				} );
				if ( cancel ) {
					return;
				}
				setFeatureFlags( {
					terminalWpCliEnabled:
						Boolean( flags?.[ 'terminal_wp_cli_enabled' ] ) || terminalWpCliEnabledFromGlobals,
					siteSyncEnabled: Boolean( flags?.[ 'site_sync_enabled' ] ) || siteSyncEnabledFromGlobals,
				} );
			} catch ( error ) {
				console.error( error );
			}
		}
		loadFeatureFlags();
		return () => {
			cancel = true;
		};
	}, [ isAuthenticated, client, terminalWpCliEnabledFromGlobals, siteSyncEnabledFromGlobals ] );

	return (
		<FeatureFlagsContext.Provider value={ featureFlags }>{ children }</FeatureFlagsContext.Provider>
	);
};

export const useFeatureFlags = (): FeatureFlagsContextType => {
	const context = useContext( FeatureFlagsContext );

	if ( ! context ) {
		throw new Error( 'useFeatureFlags must be used within an FeatureFlagsProvider' );
	}

	return context;
};
