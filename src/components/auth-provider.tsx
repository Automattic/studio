import { createContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import WPCOM from 'wpcom';
import { getIpcApi } from '../lib/get-ipc-api';

export interface AuthContextType {
	client: typeof WPCOM | undefined;
	isAuthenticated: boolean;
	authenticate: () => Promise< void >; // Adjust based on the actual implementation
	logout: () => Promise< void >; // Adjust based on the actual implementation
	user?: { email: string };
}

interface AuthProviderProps {
	children: ReactNode;
}

export const AuthContext = createContext< AuthContextType >( {
	client: undefined,
	isAuthenticated: false,
	authenticate: () => Promise.resolve(),
	logout: () => Promise.resolve(),
} );

const AuthProvider: React.FC< AuthProviderProps > = ( { children } ) => {
	const [ isAuthenticated, setIsAuthenticated ] = useState( false );
	const [ client, setClient ] = useState< typeof WPCOM | undefined >( undefined );
	const [ user, setUser ] = useState< AuthContextType[ 'user' ] >( undefined );

	const authenticate = useCallback( async () => {
		try {
			const token = await getIpcApi().authenticate();
			if ( ! token ) {
				return;
			}
			setIsAuthenticated( true );
			setClient( new WPCOM( token.accessToken ) );
			if ( token.email ) {
				setUser( { email: token.email } );
			}
		} catch ( err ) {
			console.log( err );
		}
	}, [] );

	const logout = useCallback( async () => {
		try {
			await getIpcApi().clearAuthenticationToken();
			setIsAuthenticated( false );
			setClient( undefined );
			setUser( undefined );
		} catch ( err ) {
			console.log( err );
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
					setClient( new WPCOM( token.accessToken ) );
					if ( token.email ) {
						setUser( { email: token.email } );
					}
				}
			} catch ( err ) {
				console.log( err );
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

export default AuthProvider;
