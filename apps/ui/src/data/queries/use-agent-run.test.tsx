import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { AgentRunProvider, useAgentRun } from './use-agent-run';
import { SESSIONS_QUERY_KEY, useSession } from './use-sessions';
import type { AgentRunEvent, Connector, LoadedAiSession } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

const useConnectorMock = vi.mocked( useConnector );

function createQueryClient() {
	return new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );
}

function createLoadedSession( entries: LoadedAiSession[ 'entries' ] = [] ): LoadedAiSession {
	return {
		summary: { id: 'session-1' },
		entries,
	} as LoadedAiSession;
}

function renderWithAgentRun( queryClient: QueryClient ) {
	function Harness() {
		const run = useAgentRun( 'session-1' );

		return (
			<>
				<span data-testid="phase">{ run.hasActiveRun ? 'active' : 'idle' }</span>
				<button onClick={ () => void run.sendMessage( 'Queued follow-up' ) }>Queue</button>
			</>
		);
	}

	function Wrapper( { children }: { children: ReactNode } ) {
		return (
			<QueryClientProvider client={ queryClient }>
				<AgentRunProvider>{ children }</AgentRunProvider>
			</QueryClientProvider>
		);
	}

	return render( <Harness />, { wrapper: Wrapper } );
}

describe( 'useAgentRun queued handoff', () => {
	let agentListener: ( event: AgentRunEvent ) => void;
	let connector: Pick< Connector, 'continueSession' | 'getActiveAgentRuns' | 'onAgentEvent' >;

	beforeEach( () => {
		connector = {
			continueSession: vi.fn().mockResolvedValue( { runId: 'run-next' } ),
			getActiveAgentRuns: vi.fn().mockResolvedValue( [] ),
			onAgentEvent: vi.fn( ( listener ) => {
				agentListener = listener;
				return vi.fn();
			} ),
		};
		useConnectorMock.mockReturnValue( connector as Connector );
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	it( 'does not invalidate the session cache between an old run ending and a queued prompt starting', async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData< LoadedAiSession >(
			[ ...SESSIONS_QUERY_KEY, 'session-1' ],
			createLoadedSession()
		);
		const invalidateSpy = vi.spyOn( queryClient, 'invalidateQueries' );

		renderWithAgentRun( queryClient );

		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		// Mounting reconciles persisted transcripts with disk via one
		// invalidation; this test only cares about the handoff window below.
		invalidateSpy.mockClear();

		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: { type: 'run.started', timestamp: '2026-06-24T12:00:00.000Z' },
			} );
		} );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );

		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'run.exited',
					timestamp: '2026-06-24T12:00:01.000Z',
					status: 'success',
					code: 0,
				},
			} );
		} );

		await waitFor( () =>
			expect( connector.continueSession ).toHaveBeenCalledWith(
				'session-1',
				'Queued follow-up',
				expect.objectContaining( { displayMessage: 'Queued follow-up' } )
			)
		);

		expect( invalidateSpy ).not.toHaveBeenCalled();
		expect(
			queryClient
				.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
				?.entries.some( ( entry ) => {
					if ( entry.type !== 'custom' || entry.customType !== 'studio.user_prompt' ) {
						return false;
					}
					const data = entry.data as { text?: string };
					return data.text === 'Queued follow-up';
				} )
		).toBe( true );
	} );

	it( 'still invalidates when a run ends without a queued follow-up', async () => {
		const queryClient = createQueryClient();
		const invalidateSpy = vi.spyOn( queryClient, 'invalidateQueries' );

		renderWithAgentRun( queryClient );

		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );

		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: { type: 'run.started', timestamp: '2026-06-24T12:00:00.000Z' },
			} );
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'run.exited',
					timestamp: '2026-06-24T12:00:01.000Z',
					status: 'success',
					code: 0,
				},
			} );
		} );

		expect( invalidateSpy ).toHaveBeenCalledWith( {
			queryKey: SESSIONS_QUERY_KEY,
			exact: true,
		} );
		expect( invalidateSpy ).toHaveBeenCalledWith( {
			queryKey: [ ...SESSIONS_QUERY_KEY, 'session-1' ],
			exact: true,
		} );
	} );

	it( 'refetches the transcript when a live event lands while its fetch is in flight', async () => {
		const queryClient = createQueryClient();

		const questionEntry = {
			type: 'custom',
			id: 'entry-question',
			parentId: null,
			timestamp: '2026-06-24T12:00:02.000Z',
			customType: 'studio.agent_question',
			data: { question: 'Pick one', options: [ { label: 'A', description: 'a' } ] },
		} as LoadedAiSession[ 'entries' ][ number ];

		// First load resolves with a disk snapshot read *before* the question was
		// appended; the reconciling refetch sees the question on disk.
		const resolvers: Array< ( session: LoadedAiSession ) => void > = [];
		const getSession = vi.fn(
			() => new Promise< LoadedAiSession >( ( resolve ) => resolvers.push( resolve ) )
		);
		( connector as { getSession?: typeof getSession } ).getSession = getSession;

		function TranscriptProbe() {
			const query = useSession( 'session-1' );
			return <span data-testid="entries">{ query.data?.entries.length ?? -1 }</span>;
		}

		function Wrapper( { children }: { children: ReactNode } ) {
			return (
				<QueryClientProvider client={ queryClient }>
					<AgentRunProvider>{ children }</AgentRunProvider>
				</QueryClientProvider>
			);
		}
		render( <TranscriptProbe />, { wrapper: Wrapper } );

		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		await waitFor( () => expect( getSession ).toHaveBeenCalledTimes( 1 ) );

		// The question event arrives while the initial fetch is still in flight —
		// the cache has no data to append to, so the entry would be dropped.
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-1',
				event: {
					type: 'question.asked',
					timestamp: '2026-06-24T12:00:02.000Z',
					questions: [ { question: 'Pick one', options: [ { label: 'A', description: 'a' } ] } ],
				},
			} );
		} );

		await act( async () => {
			resolvers[ 0 ]( createLoadedSession() );
		} );

		// The settled fetch predates the event, so a reconciling refetch fires
		// and its snapshot includes the question entry.
		await waitFor( () => expect( getSession ).toHaveBeenCalledTimes( 2 ) );
		await act( async () => {
			resolvers[ 1 ]( createLoadedSession( [ questionEntry ] ) );
		} );

		await waitFor( () =>
			expect(
				queryClient
					.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
					?.entries.some(
						( entry ) => entry.type === 'custom' && entry.customType === 'studio.agent_question'
					)
			).toBe( true )
		);
	} );
} );
