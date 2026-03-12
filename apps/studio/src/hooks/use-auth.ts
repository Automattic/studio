import { useCallback } from 'react';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { authLogout, selectIsAuthenticated, selectUser } from 'src/stores/auth-slice';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { AuthContextType } from 'src/components/auth-provider';

export const useAuth = (): AuthContextType => {
	const dispatch = useAppDispatch();
	const isOffline = useOffline();

	const isAuthenticated = useRootSelector( selectIsAuthenticated );
	const user = useRootSelector( selectUser );
	const client = getWpcomClient();

	const authenticate = useCallback( () => getIpcApi().authenticate(), [] );
	const logout = useCallback( async () => {
		await dispatch( authLogout( { isOffline } ) );
	}, [ dispatch, isOffline ] );

	return { isAuthenticated, user, client, authenticate, logout };
};
