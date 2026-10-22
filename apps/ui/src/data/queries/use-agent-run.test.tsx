import { STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { AgentRunProvider, useAgentRun, useStreamingReply } from './use-agent-run';
import { SESSIONS_QUERY_KEY } from './use-sessions';
import type { StreamingReply } from './streaming-reply';
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
				<span data-testid="questions">
					{ run.pendingQuestions.map( ( q ) => q.question ).join( ',' ) }
				</span>
				<button onClick={ () => void run.sendMessage( 'Queued follow-up' ) }>Queue</button>
				<button onClick={ () => run.answerQuestion( 'Q1', 'A1' ) }>Answer Q1</button>
				<button onClick={ () => void run.interrupt() }>Stop</button>
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
	let restoreConnection: () => void;
	let connector: Pick<
		Connector,
		| 'continueSession'
		| 'getActiveAgentRuns'
		| 'onAgentEvent'
		| 'onConnectionRestored'
		| 'interruptAgentRun'
		| 'answerAgentQuestion'
	>;

	beforeEach( () => {
		connector = {
			continueSession: vi.fn().mockResolvedValue( { runId: 'run-next' } ),
			interruptAgentRun: vi.fn().mockResolvedValue( undefined ),
			answerAgentQuestion: vi.fn().mockResolvedValue( undefined ),
			getActiveAgentRuns: vi.fn().mockResolvedValue( [] ),
			onAgentEvent: vi.fn( ( listener ) => {
				agentListener = listener;
				return vi.fn();
			} ),
			onConnectionRestored: vi.fn( ( listener ) => {
				restoreConnection = listener;
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

	it( 'restores a question the agent is waiting on from the active run snapshot', async () => {
		vi.mocked( connector.getActiveAgentRuns ).mockResolvedValue( [
			{
				runId: 'run-1',
				sessionId: 'session-1',
				startedAt: 1,
				phase: 'running',
				pendingQuestions: [ { question: 'Q1', options: [] } ],
			},
		] );

		renderWithAgentRun( createQueryClient() );

		await waitFor( () => expect( screen.getByTestId( 'questions' ) ).toHaveTextContent( 'Q1' ) );
		expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' );
	} );

	it( 'ends a run that finished while the event stream was disconnected', async () => {
		vi.mocked( connector.getActiveAgentRuns ).mockResolvedValueOnce( [
			{ runId: 'run-1', sessionId: 'session-1', startedAt: 1, phase: 'running' },
		] );

		renderWithAgentRun( createQueryClient() );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		act( () => restoreConnection() );

		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'idle' ) );
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

	it( 'closes a blocked question batch before it interrupts', async () => {
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
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'question.asked',
					timestamp: '2026-06-24T12:00:01.000Z',
					questions: [
						{ question: 'Q1', options: [ { label: 'A1', description: '' } ] },
						{ question: 'Q2', options: [ { label: 'A2', description: '' } ] },
					],
				},
			} );
		} );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );

		// A call killed without a result reads to the model as a broken tool, so
		// the picks so far go through and the rest are marked as unanswered.
		await waitFor( () =>
			expect( connector.answerAgentQuestion ).toHaveBeenCalledWith( 'run-old', {
				Q1: 'A1',
				Q2: STOPPED_WITHOUT_ANSWER,
			} )
		);
		expect( vi.mocked( connector.answerAgentQuestion ).mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			vi.mocked( connector.interruptAgentRun ).mock.invocationCallOrder[ 0 ]
		);
	} );

	it( 'interrupts without answering anything when no questions are open', async () => {
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );

		await waitFor( () => expect( connector.interruptAgentRun ).toHaveBeenCalledWith( 'run-old' ) );
		expect( connector.answerAgentQuestion ).not.toHaveBeenCalled();
	} );

	it( 'leaves a running turn alone when no questions are pending', async () => {
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );

		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );
		expect( connector.interruptAgentRun ).not.toHaveBeenCalled();
		expect( connector.answerAgentQuestion ).not.toHaveBeenCalled();
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

describe( 'useAgentRun streamed replies', () => {
	let agentListener: ( event: AgentRunEvent ) => void;
	let restoreConnection: () => void;
	let latestReply: StreamingReply | null = null;

	beforeEach( () => {
		latestReply = null;
		useConnectorMock.mockReturnValue( {
			continueSession: vi.fn().mockResolvedValue( { runId: 'run-1' } ),
			getActiveAgentRuns: vi
				.fn()
				.mockResolvedValue( [
					{ runId: 'run-1', sessionId: 'session-1', startedAt: 1, phase: 'running' },
				] ),
			onAgentEvent: vi.fn( ( listener: ( event: AgentRunEvent ) => void ) => {
				agentListener = listener;
				return vi.fn();
			} ),
			onConnectionRestored: vi.fn( ( listener: () => void ) => {
				restoreConnection = listener;
				return vi.fn();
			} ),
		} as unknown as Connector );
		outOfCreditsState.value = false;
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	function renderStreaming( queryClient: QueryClient ) {
		queryClient.setQueryData< LoadedAiSession >(
			[ ...SESSIONS_QUERY_KEY, 'session-1' ],
			createLoadedSession()
		);
		function Harness() {
			latestReply = useStreamingReply( 'session-1' );
			return null;
		}
		return render(
			<QueryClientProvider client={ queryClient }>
				<AgentRunProvider>
					<Harness />
				</AgentRunProvider>
			</QueryClientProvider>
		);
	}

	function emit( message: Record< string, unknown > ) {
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

	function delta( assistantMessageEvent: Record< string, unknown > ) {
		emit( { type: 'message_update', assistantMessageEvent } );
	}

	function assistantEntries( queryClient: QueryClient ) {
		return (
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
				?.entries ?? []
		).filter(
			( entry ) =>
				entry.type === 'message' &&
				( entry as { message: { role: string } } ).message.role === 'assistant'
		) as Array< { id: string; message: { content: unknown[] } } >;
	}

	it( 'streams text and an in-progress tool call, then finalizes once on message_end', async () => {
		const queryClient = createQueryClient();
		renderStreaming( queryClient );
		await waitFor( () => expect( agentListener ).toBeDefined() );

		emit( { type: 'message_start', message: { role: 'assistant', content: [] } } );
		delta( { type: 'text_start', contentIndex: 0 } );
		delta( { type: 'text_delta', contentIndex: 0, delta: 'Hel' } );
		delta( { type: 'text_delta', contentIndex: 0, delta: 'lo' } );
		delta( { type: 'toolcall_start', contentIndex: 1, id: 'call-1', name: 'Write' } );
		delta( { type: 'toolcall_delta', contentIndex: 1, delta: '{"path":"style.css"' } );

		await waitFor( () =>
			expect( latestReply?.message.content ).toEqual( [
				{ type: 'text', text: 'Hello' },
				{
					type: 'toolCall',
					id: 'call-1',
					name: 'Write',
					argumentsJson: '{"path":"style.css"',
				},
			] )
		);
		// Nothing streamed reaches the transcript cache before the message ends.
		expect( assistantEntries( queryClient ) ).toHaveLength( 0 );
		const streamedId = latestReply?.entryId;

		const finalContent = [
			{ type: 'text', text: 'Hello' },
			{ type: 'toolCall', id: 'call-1', name: 'Write', arguments: { path: 'style.css' } },
		];
		emit( { type: 'message_end', message: { role: 'assistant', content: finalContent } } );

		expect( latestReply ).toBeNull();
		const entries = assistantEntries( queryClient );
		expect( entries ).toHaveLength( 1 );
		expect( entries[ 0 ].id ).toBe( streamedId );
		expect( entries[ 0 ].message.content ).toEqual( finalContent );
	} );

	it( 'drops deltas still waiting for a frame when the message ends', async () => {
		const queryClient = createQueryClient();
		renderStreaming( queryClient );
		await waitFor( () => expect( agentListener ).toBeDefined() );

		emit( { type: 'message_start', message: { role: 'assistant', content: [] } } );
		delta( { type: 'text_delta', contentIndex: 0, delta: 'Late' } );
		emit( {
			type: 'message_end',
			message: { role: 'assistant', content: [ { type: 'text', text: 'Late' } ] },
		} );

		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		expect( latestReply ).toBeNull();
		expect( assistantEntries( queryClient ) ).toHaveLength( 1 );
	} );

	it( 'continues from the next delta when joined mid-reply', async () => {
		const queryClient = createQueryClient();
		renderStreaming( queryClient );
		await waitFor( () => expect( agentListener ).toBeDefined() );

		// No message_start: the page reloaded while the reply was streaming.
		delta( { type: 'toolcall_delta', contentIndex: 0, delta: '"content":"' } );
		delta( { type: 'text_delta', contentIndex: 1, delta: 'rest of it' } );

		await waitFor( () =>
			expect( latestReply?.message.content[ 1 ] ).toEqual( { type: 'text', text: 'rest of it' } )
		);
		expect( latestReply?.message.content[ 0 ] ).toBeUndefined();

		emit( {
			type: 'message_end',
			message: { role: 'assistant', content: [ { type: 'text', text: 'All of it' } ] },
		} );
		expect( latestReply ).toBeNull();
		expect( assistantEntries( queryClient ) ).toHaveLength( 1 );
	} );

	it( 'clears the streamed reply when the run ends or the connection drops', async () => {
		const queryClient = createQueryClient();
		renderStreaming( queryClient );
		await waitFor( () => expect( agentListener ).toBeDefined() );

		delta( { type: 'text_delta', contentIndex: 0, delta: 'Partial' } );
		await waitFor( () => expect( latestReply ).not.toBeNull() );
		act( () => restoreConnection() );
		await waitFor( () => expect( latestReply ).toBeNull() );

		delta( { type: 'text_delta', contentIndex: 0, delta: 'Again' } );
		await waitFor( () => expect( latestReply ).not.toBeNull() );
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-1',
				event: { type: 'turn.completed', timestamp: '', sessionId: 'session-1', status: 'success' },
			} );
		} );
		expect( latestReply ).toBeNull();
	} );

	it( 'ignores streamed user and tool-result messages', async () => {
		const queryClient = createQueryClient();
		renderStreaming( queryClient );
		await waitFor( () => expect( agentListener ).toBeDefined() );

		emit( { type: 'message_start', message: { role: 'user', content: 'prompt' } } );
		emit( { type: 'message_end', message: { role: 'toolResult', toolCallId: 'x', content: [] } } );
		expect( latestReply ).toBeNull();
		expect( assistantEntries( queryClient ) ).toHaveLength( 0 );
	} );
} );
