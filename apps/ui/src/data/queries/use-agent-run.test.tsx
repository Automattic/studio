import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { AgentRunProvider, useAgentRun } from './use-agent-run';
import { SESSIONS_QUERY_KEY } from './use-sessions';
import type { AgentRunEvent, Connector, LoadedAiSession } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

const { outOfCreditsState } = vi.hoisted( () => ( { outOfCreditsState: { value: false } } ) );

vi.mock( '@/hooks/use-is-out-of-ai-credits', () => ( {
	useIsOutOfAiCredits: () => outOfCreditsState.value,
} ) );

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
				<span data-testid="started-at">{ run.startedAt ?? 'none' }</span>
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
		outOfCreditsState.value = false;
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

		expect( invalidateSpy ).not.toHaveBeenCalledWith(
			expect.objectContaining( { queryKey: SESSIONS_QUERY_KEY } ),
			expect.anything()
		);
		// The old run still consumed AI credits, so the balance refreshes even
		// while the queued prompt takes over.
		expect( invalidateSpy ).toHaveBeenCalledWith( { queryKey: [ 'assistant-quota' ] } );
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

	it( 'holds a queued prompt instead of dispatching it once the credits are spent', async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData< LoadedAiSession >(
			[ ...SESSIONS_QUERY_KEY, 'session-1' ],
			createLoadedSession()
		);

		renderWithAgentRun( queryClient );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );

		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: { type: 'run.started', timestamp: '2026-06-24T12:00:00.000Z' },
			} );
		} );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		// Queued while the run was still paid for; the balance empties mid-run.
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		outOfCreditsState.value = true;

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

		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'idle' ) );
		expect( connector.continueSession ).not.toHaveBeenCalled();
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

		expect( invalidateSpy ).toHaveBeenCalledWith(
			{ queryKey: SESSIONS_QUERY_KEY },
			{ cancelRefetch: false }
		);
		expect( invalidateSpy ).toHaveBeenCalledWith( { queryKey: [ 'assistant-quota' ] } );
	} );

	it( 'preserves the optimistic start time when the backend acknowledges the run', async () => {
		let resolveContinueSession: ( value: { runId: string } ) => void = () => undefined;
		connector.continueSession = vi.fn(
			() =>
				new Promise< { runId: string } >( ( resolve ) => {
					resolveContinueSession = resolve;
				} )
		);
		const nowSpy = vi.spyOn( Date, 'now' ).mockReturnValue( 1_000 );
		renderWithAgentRun( createQueryClient() );

		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		await waitFor( () => expect( screen.getByTestId( 'started-at' ) ).toHaveTextContent( '1000' ) );

		nowSpy.mockReturnValue( 2_000 );
		await act( async () => resolveContinueSession( { runId: 'run-next' } ) );
		expect( screen.getByTestId( 'started-at' ) ).toHaveTextContent( '1000' );

		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-next',
				event: { type: 'run.started', timestamp: '1970-01-01T00:00:03.000Z' },
			} );
		} );
		expect( screen.getByTestId( 'started-at' ) ).toHaveTextContent( '1000' );
		nowSpy.mockRestore();
	} );
} );

describe( 'useAgentRun streamed assistant text', () => {
	let agentListener: ( event: AgentRunEvent ) => void;

	beforeEach( () => {
		useConnectorMock.mockReturnValue( {
			continueSession: vi.fn().mockResolvedValue( { runId: 'run-1' } ),
			getActiveAgentRuns: vi.fn().mockResolvedValue( [] ),
			onAgentEvent: vi.fn( ( listener: ( event: AgentRunEvent ) => void ) => {
				agentListener = listener;
				return vi.fn();
			} ),
		} as unknown as Connector );
		outOfCreditsState.value = false;
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	function emitPiEvent( message: Record< string, unknown > ) {
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-1',
				event: {
					type: 'message',
					timestamp: '2026-06-24T12:00:00.000Z',
					message,
				} as unknown as AgentRunEvent[ 'event' ],
			} );
		} );
	}

	function getAssistantEntries( queryClient: QueryClient ) {
		const entries =
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
				?.entries ?? [];
		return entries
			.filter(
				( entry ) =>
					entry.type === 'message' &&
					( entry as { message: { role: string } } ).message.role === 'assistant'
			)
			.map(
				( entry ) => entry as { id: string; streaming?: true; message: { content: unknown[] } }
			);
	}

	async function startRun( queryClient: QueryClient ) {
		queryClient.setQueryData< LoadedAiSession >(
			[ ...SESSIONS_QUERY_KEY, 'session-1' ],
			createLoadedSession()
		);
		renderWithAgentRun( queryClient );
		await waitFor( () => expect( agentListener ).toBeDefined() );
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-1',
				event: { type: 'run.started', timestamp: '2026-06-24T12:00:00.000Z' },
			} );
		} );
	}

	it( 'grows one assistant entry from deltas and swaps in the final message in place', async () => {
		const queryClient = createQueryClient();
		await startRun( queryClient );

		emitPiEvent( { type: 'message_start', message: { role: 'assistant', content: [] } } );
		expect( getAssistantEntries( queryClient ) ).toHaveLength( 1 );
		expect( getAssistantEntries( queryClient )[ 0 ].streaming ).toBe( true );
		const entryId = getAssistantEntries( queryClient )[ 0 ].id;

		emitPiEvent( {
			type: 'message_update',
			assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hel' },
			message: { role: 'assistant', content: [ { type: 'text', text: 'Hel' } ] },
		} );
		emitPiEvent( {
			type: 'message_update',
			assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1 },
			message: {
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Hello' },
					{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} },
				],
			},
		} );

		// Deltas coalesce into one write per frame; the half-built tool call is
		// held back until the message ends.
		await waitFor( () =>
			expect( getAssistantEntries( queryClient )[ 0 ].message.content ).toEqual( [
				{ type: 'text', text: 'Hello' },
			] )
		);
		expect( getAssistantEntries( queryClient ) ).toHaveLength( 1 );

		const finalMessage = {
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Hello world' },
				{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.php' } },
			],
		};
		emitPiEvent( { type: 'message_end', message: finalMessage } );

		const entries = getAssistantEntries( queryClient );
		expect( entries ).toHaveLength( 1 );
		expect( entries[ 0 ].id ).toBe( entryId );
		expect( entries[ 0 ].streaming ).toBeUndefined();
		expect( entries[ 0 ].message.content ).toEqual( finalMessage.content );
	} );

	it( 'starts the streamed entry from the first delta when message_start was missed', async () => {
		const queryClient = createQueryClient();
		await startRun( queryClient );

		emitPiEvent( {
			type: 'message_update',
			assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' },
			message: { role: 'assistant', content: [ { type: 'text', text: 'Hi' } ] },
		} );
		expect( getAssistantEntries( queryClient )[ 0 ].message.content ).toEqual( [
			{ type: 'text', text: 'Hi' },
		] );

		emitPiEvent( {
			type: 'message_end',
			message: { role: 'assistant', content: [ { type: 'text', text: 'Hi there' } ] },
		} );
		const entries = getAssistantEntries( queryClient );
		expect( entries ).toHaveLength( 1 );
		expect( entries[ 0 ].message.content ).toEqual( [ { type: 'text', text: 'Hi there' } ] );
	} );

	it( 'ignores streamed user and tool-result messages', async () => {
		const queryClient = createQueryClient();
		await startRun( queryClient );

		emitPiEvent( { type: 'message_start', message: { role: 'user', content: 'prompt' } } );
		emitPiEvent( {
			type: 'message_start',
			message: { role: 'toolResult', toolCallId: 'call-1', content: [] },
		} );
		expect( getAssistantEntries( queryClient ) ).toHaveLength( 0 );
	} );
} );
