import { deriveEffectiveEnvironment } from '@studio/common/ai/sessions/effective-site';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import type { AiSessionSummary, LoadedAiSession } from '@/data/core';

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

export function useSetSessionEnvironment(
	sessionId: string | undefined,
	// When available, the wpcom blog id of the live site the pill is about to
	// flip to. Used in the optimistic update so the derived-effective env can
	// resolve to 'live' immediately, without waiting for the IPC round-trip to
	// refresh `summary.lastSelectedWpcomSiteId`.
	liveWpcomSiteId: number | undefined
) {
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
			// Optimistically flip `activeEnvironment` + `lastSelectedWpcomSiteId`
			// so the derived-effective env resolves correctly on the next render,
			// rather than looking "stuck" on 'local' while the IPC round-trip
			// writes the real `site.selected` event.
			onMutate: async ( environment ) => {
				if ( ! sessionId ) {
					return { previous: undefined };
				}
				await queryClient.cancelQueries( { queryKey: sessionKey } );
				const previous = queryClient.getQueryData< LoadedAiSession >( sessionKey );
				if ( previous ) {
					queryClient.setQueryData< LoadedAiSession >( sessionKey, {
						...previous,
						summary: {
							...previous.summary,
							activeEnvironment: environment,
							lastSelectedWpcomSiteId:
								environment === 'live' ? liveWpcomSiteId : undefined,
						},
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

/**
 * Keeps session react-query caches in sync with main-process file-watcher
 * events. Any external edit to a session JSONL — UI flips, CLI appends, hand
 * edits — invalidates both the specific session entry and the list query so
 * summaries (sidebar, pill) recompute from the refreshed events. Mount once
 * near the app root.
 */
export function useSyncSessionsWithEvents(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	useEffect( () => {
		return connector.onSessionChanged( ( { sessionId } ) => {
			void queryClient.invalidateQueries( { queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ] } );
			void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
		} );
	}, [ connector, queryClient ] );
}

/**
 * Derive the *effective* environment for a session's next turn. Joins the
 * session's stored `activeEnvironment` with the live connection state for its
 * owner — a session flipped to Live whose remote is no longer connected
 * naturally falls back to 'local' without any cleanup write to the JSONL.
 */
export function useSessionEffectiveEnvironment(
	summary:
		| Pick< AiSessionSummary, 'activeEnvironment' | 'lastSelectedWpcomSiteId' | 'ownerSitePath' >
		| undefined,
	ownerLocalSiteId: string | undefined
): 'local' | 'live' {
	const { data: connectedSites } = useConnectedWpcomSites( ownerLocalSiteId );

	return useMemo( () => {
		if ( ! summary ) {
			return 'local';
		}
		const connectedLiveIds = new Set( ( connectedSites ?? [] ).map( ( site ) => site.id ) );
		return deriveEffectiveEnvironment( summary, ( blogId ) => connectedLiveIds.has( blogId ) );
	}, [ summary, connectedSites ] );
}
