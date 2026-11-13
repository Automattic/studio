import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from './use-auth-user';
import { accountSitesQueryKey } from './use-remote-sites';
import type { SitesProviderId, SiteVisibility } from '@studio/providers';

export function useSiteVisibility(
	provider: SitesProviderId,
	remoteSiteId: number | string | undefined,
	enabled: boolean
) {
	const connector = useConnector();
	const user = useAuthUser();
	const queryClient = useQueryClient();
	const queryKey = [ 'site-visibility', provider, user.data?.id, remoteSiteId ];
	const query = useQuery( {
		queryKey,
		queryFn: () => connector.getSiteVisibility( provider, remoteSiteId! ),
		enabled: enabled && !! remoteSiteId,
		staleTime: 30_000,
		refetchOnWindowFocus: 'always',
		retry: false,
	} );
	const save = useMutation( {
		mutationFn: ( visibility: SiteVisibility ) =>
			connector.setSiteVisibility( provider, remoteSiteId!, visibility ),
		onSuccess: ( details ) => {
			queryClient.setQueryData( queryKey, details );
			void queryClient.invalidateQueries( { queryKey: accountSitesQueryKey( provider ) } );
		},
		onError: () => {
			void queryClient.invalidateQueries( { queryKey } );
		},
	} );
	return { query, save };
}
