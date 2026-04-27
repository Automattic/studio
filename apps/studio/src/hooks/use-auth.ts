import { useCallback } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { authSelectors, authThunks } from 'src/stores/auth-slice';
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
	const isAuthenticated = useRootSelector( authSelectors.selectIsAuthenticated );
	const user = useRootSelector( authSelectors.selectUser );

	const authenticate = useCallback( () => getIpcApi().authenticate(), [] );

	const logout = useCallback( async () => {
		await dispatch( authThunks.authLogout() );
	}, [ dispatch ] );

	return {
		client: isAuthenticated ? getWpcomClient() : undefined,
		isAuthenticated,
		authenticate,
		logout,
		user,
	};
};
