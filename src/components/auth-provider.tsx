import * as Sentry from '@sentry/electron/renderer';
import { createContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import WPCOM from 'wpcom';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { getAppGlobals } from '../lib/app-globals';
import { getIpcApi } from '../lib/get-ipc-api';

export interface AuthContextType {
	client: WPCOM | undefined;
	isAuthenticated: boolean;
	authenticate: () => Promise< void >; // Adjust based on the actual implementation
	logout: () => Promise< void >; // Adjust based on the actual implementation
	user?: { email: string; displayName: string };
}

interface AuthProviderProps {
	children: ReactNode;
}

interface WpcomParams extends Record< string, unknown > {
	query?: string;
	apiNamespace?: string;
}

export const AuthContext = createContext< AuthContextType >( {
	client: undefined,
	isAuthenticated: false,
	authenticate: () => Promise.resolve(),
	logout: () => Promise.resolve(),
} );

const AuthProvider: React.FC< AuthProviderProps > = ( { children } ) => {
	const [ isAuthenticated, setIsAuthenticated ] = useState( false );
	const [ client, setClient ] = useState< WPCOM | undefined >( undefined );
	const [ user, setUser ] = useState< AuthContextType[ 'user' ] >( undefined );

	const authenticate = getIpcApi().authenticate;
	useIpcListener( 'auth-updated', ( _event, { token, error } ) => {
		if ( error ) {
			Sentry.captureException( error );
			return;
		}
		setIsAuthenticated( true );
		setClient( createWpcomClient( token.accessToken ) );
		if ( token.email || token.displayName ) {
			setUser( { email: token.email || '', displayName: token.displayName || '' } );
		}
	} );

	const logout = useCallback( async () => {
		try {
			await getIpcApi().clearAuthenticationToken();
			setIsAuthenticated( false );
			setClient( undefined );
			setUser( undefined );
		} catch ( err ) {
			console.error( err );
			Sentry.captureException( err );
		}
	}, [] );

	useEffect( () => {
		async function run() {
			try {
				const isAuthenticated = await getIpcApi().isAuthenticated();
				setIsAuthenticated( isAuthenticated );
				if ( isAuthenticated ) {
					const token = await getIpcApi().getAuthenticationToken();
					if ( ! token ) {
						return;
					}
					setClient( createWpcomClient( token.accessToken ) );
					if ( token.email || token.displayName ) {
						setUser( {
							email: token.email || '',
							displayName: token.displayName || '',
						} );
					}
				}
			} catch ( err ) {
				console.error( err );
				Sentry.captureException( err );
			}
		}
		run();
	}, [] );

	// Memoize the context value to avoid unnecessary renders
	const contextValue: AuthContextType = useMemo(
		() => ( {
			client,
			isAuthenticated,
			authenticate,
			logout,
			user,
		} ),
		[ client, isAuthenticated, authenticate, logout, user ]
	);

	return <AuthContext.Provider value={ contextValue }>{ children }</AuthContext.Provider>;
};

function createWpcomClient( token?: string ): WPCOM {
	const locale = getAppGlobals().locale;
	const wpcom = new WPCOM( token );

	if ( ! locale || locale === 'en' ) {
		return wpcom;
	}

	const originalRequestHandler = wpcom.request.bind( wpcom );

	return Object.assign( wpcom, {
		request: function ( params: WpcomParams, callback: unknown ) {
			const queryParams = new URLSearchParams(
				'query' in params && typeof params.query === 'string' ? params.query : ''
			);
			const localeParamName =
				'apiNamespace' in params && typeof params.apiNamespace === 'string' ? '_locale' : 'locale';
			queryParams.set( localeParamName, locale );

			Object.assign( params, {
				query: queryParams.toString(),
			} );

			return originalRequestHandler( params, callback );
		},
	} );
}

export default AuthProvider;
