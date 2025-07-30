import * as Sentry from '@sentry/react';
import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { FEATURE_FLAGS } from 'src/lib/feature-flags';
import { getIpcApi } from 'src/lib/get-ipc-api';

export type FeatureFlagsContextType = FeatureFlags;

function createDefaultFeatureFlags(): FeatureFlags {
	const flags = {} as FeatureFlags;
	for ( const [ key, def ] of Object.entries( FEATURE_FLAGS ) ) {
		const flagKey = key as keyof FeatureFlags;
		const flagDef = def as { default: boolean };
		Object.defineProperty( flags, flagKey, {
			value: flagDef.default,
			enumerable: true,
			writable: true,
			configurable: true,
		} );
	}
	return flags;
}

const defaultFeatureFlags = createDefaultFeatureFlags();

export const FeatureFlagsContext = createContext< FeatureFlagsContextType >( defaultFeatureFlags );

interface FeatureFlagsProviderProps {
	children: ReactNode;
}

export const FeatureFlagsProvider: React.FC< FeatureFlagsProviderProps > = ( { children } ) => {
	const [ featureFlags, setFeatureFlags ] = useState< FeatureFlagsContextType >( () => {
		if ( window.appGlobals ) {
			const extractedFlags: Partial< FeatureFlags > = {};
			const flagKeys = Object.keys( defaultFeatureFlags ) as ( keyof FeatureFlags )[];

			flagKeys.forEach( ( key ) => {
				if ( key in window.appGlobals ) {
					extractedFlags[ key ] = window.appGlobals[
						key as keyof typeof window.appGlobals
					] as boolean;
				}
			} );

			return {
				...defaultFeatureFlags,
				...extractedFlags,
			};
		}
		return { ...defaultFeatureFlags };
	} );
	const { isAuthenticated, client } = useAuth();

	useIpcListener( 'refresh-app-globals', async () => {
		window.appGlobals = await getIpcApi().getAppGlobals();

		const extractedFlags: Partial< FeatureFlags > = {};
		const flagKeys = Object.keys( defaultFeatureFlags ) as ( keyof FeatureFlags )[];
		flagKeys.forEach( ( key ) => {
			if ( key in window.appGlobals ) {
				extractedFlags[ key ] = window.appGlobals[
					key as keyof typeof window.appGlobals
				] as boolean;
			}
		} );

		setFeatureFlags( {
			...defaultFeatureFlags,
			...extractedFlags,
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
				// Merge API flags with current appGlobals flags
				const currentAppGlobalsFlags: Partial< FeatureFlags > = {};
				if ( window.appGlobals ) {
					const flagKeys = Object.keys( defaultFeatureFlags ) as ( keyof FeatureFlags )[];
					flagKeys.forEach( ( key ) => {
						if ( key in window.appGlobals ) {
							currentAppGlobalsFlags[ key ] = window.appGlobals[
								key as keyof typeof window.appGlobals
							] as boolean;
						}
					} );
				}

				setFeatureFlags( {
					...defaultFeatureFlags,
					...currentAppGlobalsFlags,
					...flags,
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
