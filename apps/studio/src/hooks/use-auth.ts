import { useCallback } from 'react';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { authLogout, selectIsAuthenticated, selectUser } from 'src/stores/auth-slice';
import { getWpcomClient } from 'src/stores/wpcom-client';
import type { AuthUser } from 'src/stores/auth-slice';
import type { WPCOM } from 'wpcom/types';

export interface AuthContextType {
	client: WPCOM | undefined;
	isAuthenticated: boolean;
	authenticate: () => void;
	logout: () => Promise< void >;
	user?: AuthUser;
}

export const useAuth = (): AuthContextType => {
	const dispatch = useAppDispatch();
	const isOffline = useOffline();
	const isAuthenticated = useRootSelector( selectIsAuthenticated );
	const user = useRootSelector( selectUser );

	const authenticate = useCallback( () => getIpcApi().authenticate(), [] );

	const logout = useCallback( async () => {
		await dispatch( authLogout( { isOffline } ) );
	}, [ dispatch, isOffline ] );

	return {
		client: isAuthenticated ? getWpcomClient() : undefined,
		isAuthenticated,
		authenticate,
		logout,
		user,
	};
};
