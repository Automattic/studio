import { deriveEffectiveEnvironment } from '@studio/common/ai/sessions/effective-site';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import type {
	AiModelId,
	AiSessionSummary,
	Connector,
	LoadedAiSession,
	SessionEntry,
} from '@/data/core';

export const SESSIONS_QUERY_KEY = [ 'sessions' ] as const;

export function createModelChangeEntry( modelId: AiModelId ): SessionEntry {
	return {
		type: 'model_change',
		id: Math.random().toString( 36 ).slice( 2, 10 ),
		parentId: null,
		timestamp: new Date().toISOString(),
		provider: '',
		modelId,
	} as unknown as SessionEntry;
}

export function primeSessionQueryData(
	queryClient: QueryClient,
	summary: AiSessionSummary,
	entries: SessionEntry[] = []
): void {
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
				return { ...current, summary, entries: [ ...( current.entries ?? [] ), ...entries ] };
			}
			if ( summary.firstPrompt || summary.eventCount > 0 ) {
				return current;
			}
			// A draft session has no transcript yet; this shell gives routes owner
			// metadata immediately while the JSONL loads in the background.
			return { summary, entries };
		}
	);
}

// Creates a session and primes its cache so the caller can navigate right away;
// the transcript reconciles from disk in the background.
export async function openNewSession(
	{ connector, queryClient }: { connector: Connector; queryClient: QueryClient },
	siteId?: string,
	model?: AiModelId
): Promise< AiSessionSummary > {
	const summary = await connector.createSession( siteId );
	let entries: SessionEntry[] = [];
	if ( model ) {
		entries = await connector.setSessionModel( summary.id, model ).then(
			() => [ createModelChangeEntry( model ) ],
			() => []
		);
	}
	primeSessionQueryData( queryClient, summary, entries );
	void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY, exact: true } );
	void queryClient.invalidateQueries( {
		queryKey: [ ...SESSIONS_QUERY_KEY, summary.id ],
		exact: true,
	} );
	return summary;
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

export function useCreateSession() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, model }: { siteId?: string; model?: AiModelId } ) =>
			openNewSession( { connector, queryClient }, siteId, model ),
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
