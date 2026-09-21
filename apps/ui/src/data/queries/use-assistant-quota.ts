import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';

export const ASSISTANT_QUOTA_QUERY_KEY = [ 'assistant-quota' ] as const;

export function useStudioAssistantQuota( {
	enabled = true,
	refetchOnMount,
}: { enabled?: boolean; refetchOnMount?: 'always' } = {} ) {
	const connector = useConnector();
	const { data: authUser } = useAuthUser();
	const query = useQuery( {
		// Keyed by user id so an account switch never surfaces the previous
		// account's cached quota within the stale window.
		queryKey: [ ...ASSISTANT_QUOTA_QUERY_KEY, authUser?.id ],
		queryFn: () => connector.getStudioAssistantQuota(),
		enabled: enabled && !! authUser,
		// Quota moves slowly; avoid refetching on every panel mount and
		// window focus. Spending credits invalidates the query explicitly
		// (see use-agent-run), and surfaces where the user is actively
		// checking the balance opt into `refetchOnMount: 'always'`.
		staleTime: 5 * 60 * 1000,
		refetchOnMount,
		meta: { persist: false },
	} );
	// The quota belongs to the signed-in WordPress.com account; hide any
	// cached value while signed out.
	return { ...query, data: authUser ? query.data : undefined };
}
