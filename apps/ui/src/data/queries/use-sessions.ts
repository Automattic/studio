import { deriveEffectiveEnvironment } from '@studio/common/ai/sessions/effective-site';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import type { AiSessionSummary, LoadedAiSession } from '@/data/core';

export const SESSIONS_QUERY_KEY = [ 'sessions' ] as const;

export function primeSessionQueryData( queryClient: QueryClient, summary: AiSessionSummary ): void {
	queryClient.setQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY, ( current ) => {
		const withoutSummary = ( current ?? [] ).filter( ( session ) => session.id !== summary.id );
		return [ summary, ...withoutSummary ].sort(
			( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt )
		);
	} );

	queryClient.setQueryData< LoadedAiSession >(
		[ ...SESSIONS_QUERY_KEY, summary.id ],
		( current ) => {
			if ( current ) {
				return {
					...current,
					summary,
				};
			}

			if ( summary.firstPrompt || summary.eventCount > 0 ) {
				return current;
			}

			// Newly-created draft sessions have no transcript yet. This shell
			// gives routes owner metadata immediately while the full JSONL load
			// reconciles in the background after invalidation.
			return {
				summary,
				entries: [],
			};
		}
	);
}

export function reconcilePrimedSessionQueryData(
	queryClient: QueryClient,
	sessionId: string
): Promise< void > {
	return Promise.all( [
		queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY, exact: true } ),
		queryClient.invalidateQueries( {
			queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
			exact: true,
		} ),
	] ).then( () => undefined );
}

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
		mutationFn: ( siteId?: string ) => connector.createSession( siteId ),
		onSuccess: ( summary ) => {
			primeSessionQueryData( queryClient, summary );
			void reconcilePrimedSessionQueryData( queryClient, summary.id );
		},
	} );
}

function mergeSessionMetadata(
	summary: AiSessionSummary,
	patch: Pick< AiSessionSummary, 'archived' >
): AiSessionSummary {
	return {
		...summary,
		archived: patch.archived,
	};
}

export function useUpdateSessionMetadata() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation<
		AiSessionSummary,
		Error,
		{
			sessionId: string;
			patch: Pick< AiSessionSummary, 'archived' >;
		},
		{
			previousSessions: AiSessionSummary[] | undefined;
			previousSession: LoadedAiSession | undefined;
		}
	>( {
		mutationFn: ( { sessionId, patch } ) => connector.updateSessionMetadata( sessionId, patch ),
		onMutate: async ( { sessionId, patch } ) => {
			const sessionKey = [ ...SESSIONS_QUERY_KEY, sessionId ];
			await queryClient.cancelQueries( { queryKey: SESSIONS_QUERY_KEY } );

			const previousSessions = queryClient.getQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY );
			const previousSession = queryClient.getQueryData< LoadedAiSession >( sessionKey );

			queryClient.setQueryData< AiSessionSummary[] >(
				SESSIONS_QUERY_KEY,
				( current ) =>
					current?.map( ( session ) =>
						session.id === sessionId ? mergeSessionMetadata( session, patch ) : session
					)
			);
			queryClient.setQueryData< LoadedAiSession >( sessionKey, ( current ) =>
				current
					? {
							...current,
							summary: mergeSessionMetadata( current.summary, patch ),
					  }
					: current
			);

			return { previousSessions, previousSession };
		},
		onError: ( _error, { sessionId }, context ) => {
			if ( context?.previousSessions ) {
				queryClient.setQueryData( SESSIONS_QUERY_KEY, context.previousSessions );
			}
			if ( context?.previousSession ) {
				queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, sessionId ], context.previousSession );
			}
		},
		onSuccess: ( summary ) => {
			queryClient.setQueryData< AiSessionSummary[] >(
				SESSIONS_QUERY_KEY,
				( current ) =>
					current?.map( ( session ) => ( session.id === summary.id ? summary : session ) )
			);
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, summary.id ],
				( current ) =>
					current
						? {
								...current,
								summary: {
									...current.summary,
									archived: summary.archived,
								},
						  }
						: current
			);
		},
		onSettled: ( _data, _error, { sessionId } ) => {
			void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			void queryClient.invalidateQueries( { queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ] } );
		},
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
							lastSelectedWpcomSiteId: environment === 'live' ? liveWpcomSiteId : undefined,
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

export function useSyncSessionsWithEvents(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	useEffect( () => {
		return connector.onSessionPlacementUpdated( ( event ) => {
			void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			void queryClient.invalidateQueries( {
				queryKey: [ ...SESSIONS_QUERY_KEY, event.sessionId ],
			} );
		} );
	}, [ connector, queryClient ] );
}
