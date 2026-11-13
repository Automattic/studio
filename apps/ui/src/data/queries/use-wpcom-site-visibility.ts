import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from './use-auth-user';
import { ACCOUNT_SITES_QUERY_KEY } from './user-scoped-query-keys';
import type { WpcomSiteVisibility } from '@studio/common/types/site-visibility';

export function useWpcomSiteVisibility( remoteSiteId: number | undefined, enabled: boolean ) {
	const connector = useConnector();
	const user = useAuthUser();
	const queryClient = useQueryClient();
	const queryKey = [ 'wpcom-site-visibility', user.data?.id, remoteSiteId ];
	const query = useQuery( {
		queryKey,
		queryFn: () => connector.getWpcomSiteVisibility( remoteSiteId! ),
		enabled: enabled && !! remoteSiteId && !! user.data,
		staleTime: 30_000,
		refetchOnWindowFocus: 'always',
		retry: false,
	} );
	const save = useMutation( {
		mutationFn: ( visibility: WpcomSiteVisibility ) =>
			connector.setWpcomSiteVisibility( remoteSiteId!, visibility ),
		onSuccess: ( details ) => {
			queryClient.setQueryData( queryKey, details );
			void queryClient.invalidateQueries( { queryKey: ACCOUNT_SITES_QUERY_KEY } );
		},
		onError: () => {
			void queryClient.invalidateQueries( { queryKey } );
		},
	} );
	return { query, save };
}
