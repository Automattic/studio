import * as Sentry from '@sentry/react';
import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { z } from 'zod';
import { useAuth } from 'src/hooks/use-auth';

// In PHP, empty associative arrays are encoded as regular arrays when converted to JSON.
// This means an empty feature flags response comes as [] instead of {}.
const featureFlagsSchema = z.object( {} ).catch( ( _: unknown ) => ( {} ) );

// Will be extended with feature flags in the future */
export type FeatureFlagsContextType = Record< string, never >;

export const FeatureFlagsContext = createContext< FeatureFlagsContextType >( {} );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( {} );
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
				setFeatureFlags( flags );
			} catch ( error ) {
				Sentry.captureException( error );
				console.error( error );
			}
		}
		void loadFeatureFlags();
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
