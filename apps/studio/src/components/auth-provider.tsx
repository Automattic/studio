import { useI18n } from '@wordpress/react-i18n';
import { createContext, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector, useI18nLocale } from 'src/stores';
import {
	authLogout,
	authTokenReceived,
	initializeAuth,
	selectIsAuthenticated,
	selectUser,
} from 'src/stores/auth-slice';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { WPCOM } from 'wpcom/types';

export interface AuthContextType {
	client: WPCOM | undefined;
	isAuthenticated: boolean;
	authenticate: () => void;
	logout: () => Promise< void >;
	user?: { id: number; email: string; displayName: string };
}

interface AuthProviderProps {
	children: ReactNode;
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
	const dispatch = useAppDispatch();
	const locale = useI18nLocale();
	const { __ } = useI18n();
	const isOffline = useOffline();

	const isAuthenticated = useRootSelector( selectIsAuthenticated );
	const user = useRootSelector( selectUser );

	const authenticate = useCallback( () => getIpcApi().authenticate(), [] );

	useEffect( () => {
		void dispatch( initializeAuth( { locale } ) );
	}, [ dispatch, locale ] );

	useIpcListener( 'auth-updated', ( _event, payload ) => {
		if ( 'error' in payload ) {
			let title: string = __( 'Authentication error' );
			let message: string = __( 'Please try again.' );

			if ( payload.error instanceof Error && payload.error.message.includes( 'access_denied' ) ) {
				title = __( 'Authorization denied' );
				message = __(
					'It looks like you denied the authorization request. To proceed, please click "Approve"'
				);
			}

			void getIpcApi().showErrorMessageBox( { title, message } );
			return;
		}

		void dispatch( authTokenReceived( { token: payload.token, locale } ) );
	} );

	const logout = useCallback( async () => {
		await dispatch( authLogout( { isOffline } ) );
	}, [ dispatch, isOffline ] );

	const contextValue: AuthContextType = useMemo(
		() => ( {
			client: getWpcomClient(),
			isAuthenticated,
			authenticate,
			logout,
			user,
		} ),
		[ isAuthenticated, authenticate, logout, user ]
	);

	return <AuthContext.Provider value={ contextValue }>{ children }</AuthContext.Provider>;
};

export default AuthProvider;
