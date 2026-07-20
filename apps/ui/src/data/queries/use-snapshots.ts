import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';

export const SNAPSHOTS_QUERY_KEY = [ 'snapshots' ] as const;

export function useSnapshots() {
	const connector = useConnector();
	const { data: authUser } = useAuthUser();
	const query = useQuery( {
		queryKey: SNAPSHOTS_QUERY_KEY,
		queryFn: () => connector.getSnapshots(),
		enabled: !! authUser,
	} );
	// Preview sites belong to the signed-in WordPress.com account. Disabling
	// the query alone isn't enough — React Query keeps the cached list around
	// after logout, so hide it explicitly while signed out.
	return { ...query, data: authUser ? query.data : undefined };
}
