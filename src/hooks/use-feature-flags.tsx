import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useAuth } from './use-auth';

export interface FeatureFlagsContextType {
	assistantEnabled: boolean;
}

const defaultFeatureFlags: FeatureFlagsContextType = {
	assistantEnabled: false,
};

export const FeatureFlagsContext = createContext< FeatureFlagsContextType >( defaultFeatureFlags );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const [ featureFlags, setFeatureFlags ] =
		useState< FeatureFlagsContextType >( defaultFeatureFlags );
	const { isAuthenticated, client } = useAuth();

	useEffect( () => {
		if ( ! isAuthenticated || ! client ) {
			return;
		}
		let cancel = false;
		async function loadFeatureFlags() {
			setTimeout( () => {
				if ( cancel ) {
					return;
				}
				setFeatureFlags( {
					assistantEnabled: true,
				} );
			}, 1000 );
		}
		loadFeatureFlags();
		return () => {
			cancel = true;
		};
	}, [ isAuthenticated, client ] );

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
