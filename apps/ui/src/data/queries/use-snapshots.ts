import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const SNAPSHOTS_QUERY_KEY = [ 'snapshots' ] as const;

export function useSnapshots() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SNAPSHOTS_QUERY_KEY,
		queryFn: () => connector.getSnapshots(),
	} );
}
