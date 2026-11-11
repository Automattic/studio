import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import type {
	AiModelId,
	AiSessionMetadata,
	AiSessionSummary,
	Connector,
	LoadedAiSession,
	SessionEntry,
	SyncSite,
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
		// The sidebar mounts its retry row once a first load fails: refetched on
		// that mount, the list would go back to loading, unmount the row, fail
		// again and repeat forever.
		retryOnMount: false,
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
		// cache writes and flicker the transcript. A transcript restored from the
		// persisted cache can miss entries, so only that one refetches on mount.
		refetchOnMount: ( query ) =>
			query.state.dataUpdatedAt < performance.timeOrigin ? 'always' : false,
		retryOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
	} );
}

export function useSetSessionEnvironment( sessionId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( environment: 'local' | 'live' ) =>
			connector.setSessionEnvironment( sessionId, environment ),
		onError: ( error ) =>
			toast.error( __( 'Couldn’t switch the site this chat works on' ), {
				description: error.message,
			} ),
		onSettled: () =>
			queryClient.invalidateQueries( { queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ] } ),
	} );
}

function mergeSessionMetadata(
	summary: AiSessionSummary,
	patch: AiSessionMetadata
): AiSessionSummary {
	return { ...summary, ...patch };
}

export function useUpdateSessionMetadata() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation<
		AiSessionSummary,
		Error,
		{
			sessionId: string;
			patch: AiSessionMetadata;
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
									title: summary.title,
									unread: summary.unread,
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
 * The connected remote a chat switched to Live works on. A chat whose remote
 * is no longer connected falls back to Local, without any cleanup write to
 * the JSONL.
 */
export function useSessionLiveSite(
	summary: Pick< AiSessionSummary, 'activeEnvironment' | 'lastSelectedWpcomSiteId' > | undefined,
	ownerLocalSiteId: string | undefined
): SyncSite | undefined {
	const { data: connectedSites } = useConnectedWpcomSites( ownerLocalSiteId );
	return summary?.activeEnvironment === 'live'
		? connectedSites?.find( ( site ) => site.id === summary.lastSelectedWpcomSiteId )
		: undefined;
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
