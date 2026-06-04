import * as Sentry from '@sentry/electron/renderer';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { useI18n } from '@wordpress/react-i18n';
import { createContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { isInvalidTokenError } from 'src/lib/is-invalid-oauth-token-error';
import { setSentryWpcomUserIdRenderer } from 'src/lib/renderer-sentry-utils';
import { useAppDispatch, useI18nLocale } from 'src/stores';
import { userLoggedOut } from 'src/stores/auth-actions';
import { setWpcomClient } from 'src/stores/wpcom-api';
import type { WPCOM } from 'wpcom/types';

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
	const locale = useI18nLocale();
	const { __ } = useI18n();
	const isOffline = useOffline();

	const dispatch = useAppDispatch();
	const authenticate = useCallback( () => getIpcApi().authenticate(), [] );

	const handleInvalidToken = useCallback( async () => {
		try {
			void getIpcApi().logRendererMessage( 'info', 'Detected invalid token. Logging out.' );
			dispatch( userLoggedOut() );
			await getIpcApi().clearAuthenticationToken();
			setIsAuthenticated( false );
			setClient( undefined );
			setUser( undefined );
			setSentryWpcomUserIdRenderer( undefined );
		} catch ( err ) {
			console.error( 'Failed to handle invalid token:', err );
		}
	}, [ dispatch ] );

	useIpcListener( 'auth-updated', ( _event, payload ) => {
		if ( 'error' in payload ) {
			let title: string = __( 'Authentication error' );
			let message: string = __( 'Please try again.' );

			// User has denied access to the authorization dialog.
			if ( payload.error instanceof Error && payload.error.message.includes( 'access_denied' ) ) {
				title = __( 'Authorization denied' );
				message = __(
					'It looks like you denied the authorization request. To proceed, please click "Approve"'
				);
			}

			void getIpcApi().showErrorMessageBox( { title, message } );
			return;
		}

		const { token } = payload;

		if ( ! token ) {
			setIsAuthenticated( false );
			setClient( undefined );
			setWpcomClient( undefined );
			setUser( undefined );
			setSentryWpcomUserIdRenderer( undefined );
			return;
		}

		const newClient = createWpcomClient( token.accessToken, locale, handleInvalidToken );

		setIsAuthenticated( true );
		setClient( newClient );
		setWpcomClient( newClient );
		setUser( {
			id: token.id,
			email: token.email,
			displayName: token.displayName || '',
		} );
		setSentryWpcomUserIdRenderer( token.id );
	} );

	const logout = useCallback( async () => {
		if ( ! isOffline && client ) {
			try {
				await client.req.del( {
					apiNamespace: 'wpcom/v2',
					path: '/studio-app/token',
					// wpcom.req.del defaults to POST; explicitly send HTTP DELETE for v2
					method: 'DELETE',
				} );
				console.log( 'Token revoked' );
			} catch ( err ) {
				console.error( 'Failed to revoke token:', err );
			}
		} else if ( isOffline ) {
			console.log( 'Offline: Skipping token revocation request' );
		}

		try {
			dispatch( userLoggedOut() );
			await getIpcApi().clearAuthenticationToken();
			setIsAuthenticated( false );
			setClient( undefined );
			setUser( undefined );
			setSentryWpcomUserIdRenderer( undefined );
		} catch ( err ) {
			console.error( err );
		}
	}, [ client, dispatch, isOffline ] );

	useEffect( () => {
		async function run() {
			try {
				const token = await getIpcApi().getAuthenticationToken();

				if ( ! token ) {
					setIsAuthenticated( false );
					return;
				}

				const newClient = createWpcomClient( token.accessToken, locale, handleInvalidToken );

				setIsAuthenticated( true );
				setClient( newClient );
				setWpcomClient( newClient );
				setUser( {
					id: token.id,
					email: token.email,
					displayName: token.displayName || '',
				} );
				setSentryWpcomUserIdRenderer( token.id );
			} catch ( err ) {
				console.error( err );
				Sentry.captureException( err );
			}
		}
		void run();
	}, [ locale, handleInvalidToken ] );

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

function createWpcomClient(
	token?: string,
	locale?: string,
	onInvalidToken?: () => Promise< void >
): WPCOM {
	let isAuthErrorDialogOpen = false;
	const handleInvalidTokenError = async ( response: unknown ) => {
		if ( isInvalidTokenError( response ) && onInvalidToken && ! isAuthErrorDialogOpen ) {
			isAuthErrorDialogOpen = true;
			await onInvalidToken();
			await getIpcApi().showMessageBox( {
				type: 'error',
				message: 'Session Expired',
				detail: 'Your session has expired. Please log in again.',
			} );
			isAuthErrorDialogOpen = false;
		}
	};

	const addLocaleToParams = ( params: WpcomParams ) => {
		if ( locale && locale !== 'en' ) {
			const queryParams = new URLSearchParams(
				'query' in params && typeof params.query === 'string' ? params.query : ''
			);
			const localeParamName =
				'apiNamespace' in params && typeof params.apiNamespace === 'string' ? '_locale' : 'locale';
			queryParams.set( localeParamName, locale );

			Object.assign( params, {
				query: queryParams.toString(),
			} );
		}
		return params;
	};

	// Wrap the request handler to add locale and error handling before passing to wpcomFactory
	const wrappedRequestHandler = (
		params: object,
		callback: ( err: unknown, response?: unknown, headers?: unknown ) => void
	) => {
		const modifiedParams = addLocaleToParams( params as WpcomParams );
		const wrappedCallback = ( err: unknown, response: unknown, headers: unknown ) => {
			if ( err ) {
				void handleInvalidTokenError( err );
			}
			if ( typeof callback === 'function' ) {
				callback( err, response, headers );
			}
		};

		return wpcomXhrRequest( modifiedParams, wrappedCallback );
	};

	return wpcomFactory( token, wrappedRequestHandler );
}

export default AuthProvider;
