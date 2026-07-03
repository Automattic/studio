import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const LOCAL_MEDIA_QUERY_KEY = [ 'local-media' ] as const;

export function useLocalMediaFile( path: string | null ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...LOCAL_MEDIA_QUERY_KEY, path ],
		queryFn: () => connector.readLocalMediaFile( path! ),
		enabled: !! path,
		// Screenshot files are immutable once written, so a cached read stays
		// valid for the lifetime of the app; the cache also prevents re-reading
		// multi-MB files over IPC when the conversation remounts.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
	} );
}
