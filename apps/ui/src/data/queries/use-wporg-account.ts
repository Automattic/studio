import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const WPORG_ACCOUNT_QUERY_KEY = [ 'wporg-account' ] as const;

/**
 * The connected WordPress.org account (plugin development), or null when not
 * connected. Distinct from the WordPress.com account — .org uses its own
 * credentials for plugin submissions and releases.
 */
export function useWordPressOrgAccount() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WPORG_ACCOUNT_QUERY_KEY,
		queryFn: () => connector.getWordPressOrgAccount(),
		meta: { persist: false },
	} );
}

/** Opens the isolated WordPress.org login window and resolves on success. */
export function useWordPressOrgLogin() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.loginToWordPressOrg(),
		onSettled: () => queryClient.invalidateQueries( { queryKey: WPORG_ACCOUNT_QUERY_KEY } ),
	} );
}

export function useWordPressOrgLogout() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.logoutFromWordPressOrg(),
		onSettled: () => queryClient.invalidateQueries( { queryKey: WPORG_ACCOUNT_QUERY_KEY } ),
	} );
}
