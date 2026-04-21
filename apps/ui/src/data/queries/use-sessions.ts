import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { LoadedAiSession } from '@/data/core';

export const SESSIONS_QUERY_KEY = [ 'sessions' ] as const;

export function useSessions() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SESSIONS_QUERY_KEY,
		queryFn: () => connector.getSessions(),
	} );
}

export function useSession( sessionId: string | undefined ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
		queryFn: () => connector.getSession( sessionId! ),
		enabled: !! sessionId,
		// `useAgentRun` mutates the cache during a live run and invalidates
		// explicitly on `run.exited`. Any implicit refetch would race those
		// cache writes and flicker the transcript.
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
	} );
}

export function useDeleteSession() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( sessionId: string ) => connector.deleteSession( sessionId ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } ),
	} );
}

export function useCreateSession() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( siteId: string ) => connector.createSession( siteId ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } ),
	} );
}

export function useSetSessionEnvironment( sessionId: string | undefined ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const sessionKey = [ ...SESSIONS_QUERY_KEY, sessionId ];
	return useMutation< unknown, Error, 'local' | 'live', { previous: LoadedAiSession | undefined } >(
		{
			mutationFn: ( environment ) => {
				if ( ! sessionId ) {
					throw new Error( 'No session selected' );
				}
				return connector.setSessionEnvironment( sessionId, environment );
			},
			// Optimistically flip `activeEnvironment` so the pill (and anything
			// else reading the summary) updates the moment the user clicks,
			// rather than waiting for the IPC round-trip to the main process.
			onMutate: async ( environment ) => {
				if ( ! sessionId ) {
					return { previous: undefined };
				}
				await queryClient.cancelQueries( { queryKey: sessionKey } );
				const previous = queryClient.getQueryData< LoadedAiSession >( sessionKey );
				if ( previous ) {
					queryClient.setQueryData< LoadedAiSession >( sessionKey, {
						...previous,
						summary: { ...previous.summary, activeEnvironment: environment },
					} );
				}
				return { previous };
			},
			onError: ( _error, _variables, context ) => {
				if ( context?.previous ) {
					queryClient.setQueryData( sessionKey, context.previous );
				}
			},
			onSettled: () => {
				// Reconcile against the server-side event log so the cache matches the
				// JSONL truth, and refresh the sidebar list which shows env indicators.
				void queryClient.invalidateQueries( { queryKey: sessionKey } );
				void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			},
		}
	);
}
