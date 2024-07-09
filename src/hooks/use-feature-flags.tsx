import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { getAppGlobals } from '../lib/app-globals';
import { useAuth } from './use-auth';

export interface FeatureFlagsContextType {
	assistantEnabled: boolean;
	terminalWpCliEnabled: boolean;
	backupEnabled: boolean;
}

export const FeatureFlagsContext = createContext< FeatureFlagsContextType >( {
	assistantEnabled: false,
	terminalWpCliEnabled: false,
	backupEnabled: false,
} );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const assistantEnabledFromGlobals = getAppGlobals().assistantEnabled;
	const terminalWpCliEnabledFromGlobals = getAppGlobals().terminalWpCliEnabled;
	const backupEnabledFromGlobals = getAppGlobals().backupEnabled;
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( {
		assistantEnabled: assistantEnabledFromGlobals,
		terminalWpCliEnabled: terminalWpCliEnabledFromGlobals,
		backupEnabled: backupEnabledFromGlobals,
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
				console.log( flags );
				setFeatureFlags( {
					assistantEnabled:
						Boolean( flags?.[ 'assistant_enabled' ] ) || assistantEnabledFromGlobals,
					terminalWpCliEnabled:
						Boolean( flags?.[ 'terminal_wp_cli_enabled' ] ) || terminalWpCliEnabledFromGlobals,
					backupEnabled: Boolean( flags?.[ 'backup_enabled' ] ) || backupEnabledFromGlobals,
				} );
			} catch ( error ) {
				console.error( error );
			}
		}
		loadFeatureFlags();
		return () => {
			cancel = true;
		};
	}, [
		isAuthenticated,
		client,
		assistantEnabledFromGlobals,
		terminalWpCliEnabledFromGlobals,
		backupEnabledFromGlobals,
	] );

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
