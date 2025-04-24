import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { createContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import WPCOM from 'wpcom';
import { useI18nData } from 'src/hooks/use-i18n-data';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { setWpcomClient } from 'src/stores/wpcom-api';

export interface AuthContextType {
	client: WPCOM | undefined;
	isAuthenticated: boolean;
	authenticate: () => void; // Adjust based on the actual implementation
	logout: () => Promise< void >; // Adjust based on the actual implementation
	user?: { id: number; email: string; displayName: string };
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
	authenticate: () => {
		// Placeholder for authenticate logic. Just to avoid lint error
	},
	logout: () => Promise.resolve(),
} );

const AuthProvider: React.FC< AuthProviderProps > = ( { children } ) => {
	const [ isAuthenticated, setIsAuthenticated ] = useState( false );
	const [ client, setClient ] = useState< WPCOM | undefined >( undefined );
	const [ user, setUser ] = useState< AuthContextType[ 'user' ] >( undefined );
	const { locale } = useI18nData();
	const { __ } = useI18n();

	const authenticate = useCallback( () => getIpcApi().authenticate(), [] );

	useIpcListener( 'auth-updated', ( _event, payload ) => {
		if ( 'error' in payload ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Authentication error' ),
				message: __( 'Please try again.' ),
			} );
			return;
		}

		const { token } = payload;
		const newClient = createWpcomClient( token.accessToken, locale );

		setIsAuthenticated( true );
		setClient( newClient );
		setWpcomClient( newClient );
		setUser( {
			id: token.id,
			email: token.email,
			displayName: token.displayName || '',
		} );
	} );

	const logout = useCallback( async () => {
		try {
			await getIpcApi().clearAuthenticationToken();
			setIsAuthenticated( false );
			setClient( undefined );
			setWpcomClient( undefined );
			setUser( undefined );
		} catch ( err ) {
			console.error( err );
			Sentry.captureException( err );
		}
	}, [] );

	useEffect( () => {
		async function run() {
			try {
				const token = await getIpcApi().getAuthenticationToken();

				if ( ! token ) {
					setIsAuthenticated( false );
					return;
				}

				const newClient = createWpcomClient( token.accessToken, locale );

				setIsAuthenticated( true );
				setClient( newClient );
				setWpcomClient( newClient );
				setUser( {
					id: token.id,
					email: token.email,
					displayName: token.displayName || '',
				} );
			} catch ( err ) {
				console.error( err );
				Sentry.captureException( err );
			}
		}
		void run();
	}, [ locale ] );

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

function createWpcomClient( token?: string, locale?: string ): WPCOM {
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
