import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { FEATURE_FLAGS } from 'src/lib/feature-flags';
import { getIpcApi } from 'src/lib/get-ipc-api';

type FeatureFlagsContextType = FeatureFlags;

function createDefaultFeatureFlags(): FeatureFlags {
	const flags = {} as FeatureFlags;
	for ( const [ key, def ] of Object.entries( FEATURE_FLAGS ) ) {
		const flagKey = key as keyof FeatureFlags;
		const flagDef = def as { default: boolean };
		Object.defineProperty( flags, flagKey, { value: flagDef.default } );
	}
	return flags;
}

const defaultFeatureFlags = createDefaultFeatureFlags();

const FeatureFlagsContext = createContext< FeatureFlagsContextType >( defaultFeatureFlags );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( () => {
		return {
			...defaultFeatureFlags,
			...window.appGlobals,
		};
	} );
	const { isAuthenticated, client } = useAuth();
	const [ apiFlags, setApiFlags ] = useState< Partial< FeatureFlags > >( {} );

	useIpcListener( 'refresh-app-globals', async () => {
		window.appGlobals = await getIpcApi().getAppGlobals();
		setFeatureFlags( {
			...defaultFeatureFlags,
			...window.appGlobals,
			...apiFlags,
		} );
	} );

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
				const flags = response as Partial< FeatureFlags >;
				if ( cancel ) {
					return;
				}
				setApiFlags( flags );
				setFeatureFlags( {
					...defaultFeatureFlags,
					...window.appGlobals,
					...flags,
				} );
			} catch ( error ) {
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
