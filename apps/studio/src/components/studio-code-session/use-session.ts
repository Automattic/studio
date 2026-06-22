import { useQuery } from '@tanstack/react-query';
import { getIpcApi } from 'src/lib/get-ipc-api';

export const SESSIONS_QUERY_KEY = [ 'sessions' ] as const;

export function useSession( sessionId: string | undefined ) {
	return useQuery( {
		queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
		queryFn: () => getIpcApi().loadAiSession( sessionId! ),
		enabled: !! sessionId,
		// `useAgentRun` mutates the cache during a live run and invalidates
		// explicitly on `run.exited`. Any implicit refetch would race those
		// cache writes and flicker the transcript.
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
	} );
}
