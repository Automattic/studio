import * as Sentry from '@sentry/react';
import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { z } from 'zod';
import { useAuth } from 'src/hooks/use-auth';
import { getAppGlobals } from 'src/lib/app-globals';

// In PHP, empty associative arrays are encoded as regular arrays when converted to JSON.
// This means an empty feature flags response comes as [] instead of {}.
const featureFlagsSchema = z
	.object( {
		terminal_wp_cli_enabled: z.boolean().optional(),
	} )
	.catch( ( _ ) => ( {} ) );

export interface FeatureFlagsContextType {
	terminalWpCliEnabled: boolean;
}

export const FeatureFlagsContext = createContext< FeatureFlagsContextType >( {
	terminalWpCliEnabled: false,
} );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const terminalWpCliEnabledFromGlobals = getAppGlobals().terminalWpCliEnabled;
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( {
		terminalWpCliEnabled: terminalWpCliEnabledFromGlobals,
	} );
	const { isAuthenticated, client } = useAuth();

	useEffect( () => {
		let cancel = false;
		async function loadFeatureFlags() {
			if ( ! isAuthenticated || ! client ) {
				return;
			}
			try {
				const response = await client.req.get( {
					path: '/studio-app/feature-flags',
					apiNamespace: 'wpcom/v2',
				} );
				const flags = featureFlagsSchema.parse( response );
				if ( cancel ) {
					return;
				}
				setFeatureFlags( {
					terminalWpCliEnabled:
						Boolean( flags.terminal_wp_cli_enabled ) || terminalWpCliEnabledFromGlobals,
				} );
			} catch ( error ) {
				Sentry.captureException( error );
				console.error( error );
			}
		}
		void loadFeatureFlags();
		return () => {
			cancel = true;
		};
	}, [ isAuthenticated, client, terminalWpCliEnabledFromGlobals ] );

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
