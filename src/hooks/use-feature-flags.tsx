import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { getAppGlobals } from '../lib/app-globals';
import { useAuth } from './use-auth';

export interface FeatureFlagsContextType {
	assistantEnabled: boolean;
}

export const FeatureFlagsContext = createContext< FeatureFlagsContextType >( {
	assistantEnabled: false,
} );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const assistantEnabledFromGlobals = getAppGlobals().assistantEnabled;
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( {
		assistantEnabled: assistantEnabledFromGlobals,
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
					assistantEnabled: Boolean( flags?.assistantEnabled ) || assistantEnabledFromGlobals,
				} );
			} catch ( error ) {
				console.error( error );
			}
		}
		loadFeatureFlags();
		return () => {
			cancel = true;
		};
	}, [ isAuthenticated, client, assistantEnabledFromGlobals ] );

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
