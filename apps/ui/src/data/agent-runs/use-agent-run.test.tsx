import { STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { ASSISTANT_QUOTA_QUERY_KEY } from '@/data/queries/use-assistant-quota';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { AgentRunProvider } from './provider';
import { useAgentRun } from './use-agent-run';
import type { AgentRunEvent, Connector, LoadedAiSession } from '@/data/core';
import type { ActiveAgentRun } from '@studio/common/ai/agent-events';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

const { outOfCreditsState } = vi.hoisted( () => ( { outOfCreditsState: { value: false } } ) );

vi.mock( '@/data/queries/use-is-out-of-ai-credits', () => ( {
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

function deferredRuns() {
	let resolve!: ( runs: ActiveAgentRun[] ) => void;
	const promise = new Promise< ActiveAgentRun[] >( ( done ) => ( resolve = done ) );
	return { promise, resolve };
}

function renderWithAgentRun( queryClient: QueryClient ) {
	function Harness() {
		const run = useAgentRun( 'session-1' );

		return (
			<>
				<span data-testid="phase">{ run.hasActiveRun ? 'active' : 'idle' }</span>
				<span data-testid="interrupting">{ String( run.isInterrupting ) }</span>
				<span data-testid="started-at">{ run.startedAt ?? 'none' }</span>
				<span data-testid="questions">
					{ run.pendingQuestions.map( ( q ) => q.question ).join( ',' ) }
				</span>
				<button onClick={ () => void run.sendMessage( 'Queued follow-up' ).catch( () => {} ) }>
					Queue
				</button>
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
		| 'getAiSettings'
	>;

	beforeEach( () => {
		connector = {
			continueSession: vi.fn().mockResolvedValue( { runId: 'run-next' } ),
			interruptAgentRun: vi.fn().mockResolvedValue( undefined ),
			answerAgentQuestion: vi.fn().mockResolvedValue( undefined ),
			getAiSettings: vi.fn().mockResolvedValue( {
				provider: 'wpcom',
				hasAnthropicApiKey: false,
				anthropicApiKeyPreview: null,
			} ),
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

	it( 'keeps a run that ended while a reconnect snapshot was in flight', async () => {
		const snapshot = deferredRuns();
		renderWithAgentRun( createQueryClient() );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		startOldRun();
		vi.mocked( connector.getActiveAgentRuns ).mockReturnValueOnce( snapshot.promise );

		act( () => restoreConnection() );
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'run.exited',
					timestamp: '2026-06-24T12:00:02.000Z',
					status: 'success',
					code: 0,
				},
			} );
		} );
		await act( async () =>
			snapshot.resolve( [
				{ runId: 'run-old', sessionId: 'session-1', startedAt: 1, phase: 'running' },
			] )
		);

		expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'idle' );
	} );

	it( 'ignores a snapshot that lands after a newer one', async () => {
		const older = deferredRuns();
		const newer = deferredRuns();
		renderWithAgentRun( createQueryClient() );
		await waitFor( () => expect( connector.onConnectionRestored ).toHaveBeenCalled() );
		vi.mocked( connector.getActiveAgentRuns )
			.mockReturnValueOnce( older.promise )
			.mockReturnValueOnce( newer.promise );

		act( () => restoreConnection() );
		act( () => restoreConnection() );
		await act( async () => newer.resolve( [] ) );
		await act( async () =>
			older.resolve( [
				{ runId: 'run-1', sessionId: 'session-1', startedAt: 1, phase: 'running' },
			] )
		);

		expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'idle' );
	} );

	it( 'refreshes the chats and the credit balance on reconnect', async () => {
		const queryClient = createQueryClient();
		const invalidateSpy = vi.spyOn( queryClient, 'invalidateQueries' );
		renderWithAgentRun( queryClient );
		await waitFor( () => expect( connector.onConnectionRestored ).toHaveBeenCalled() );

		act( () => restoreConnection() );

		expect( invalidateSpy ).toHaveBeenCalledWith(
			{ queryKey: SESSIONS_QUERY_KEY },
			{ cancelRefetch: false }
		);
		expect( invalidateSpy ).toHaveBeenCalledWith( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
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
	function startOldRun() {
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: { type: 'run.started', timestamp: '2026-06-24T12:00:00.000Z' },
			} );
		} );
	}

	function exitOldRun( type: 'run.exited' | 'run.interrupted' = 'run.exited' ) {
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type,
					timestamp: '2026-06-24T12:00:01.000Z',
					status: 'success',
					code: 0,
				} as AgentRunEvent[ 'event' ],
			} );
		} );
	}

	it( 'returns to idle when a run fails to start', async () => {
		connector.continueSession = vi.fn().mockRejectedValue( new Error( 'offline' ) );
		renderWithAgentRun( createQueryClient() );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );

		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );

		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalled() );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'idle' ) );
	} );

	it( 'sends a queued prompt after its chat is closed', async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData< LoadedAiSession >(
			[ ...SESSIONS_QUERY_KEY, 'session-1' ],
			createLoadedSession()
		);
		const { rerender } = renderWithAgentRun( queryClient );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		startOldRun();
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );

		rerender( <></> );
		exitOldRun();

		await waitFor( () =>
			expect( connector.continueSession ).toHaveBeenCalledWith(
				'session-1',
				'Queued follow-up',
				expect.anything()
			)
		);
	} );

	it( 'does not hold the queue of an Anthropic chat on WordPress.com credits', async () => {
		vi.mocked( connector.getAiSettings ).mockResolvedValue( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: null,
		} );
		outOfCreditsState.value = true;
		const queryClient = createQueryClient();
		queryClient.setQueryData< LoadedAiSession >(
			[ ...SESSIONS_QUERY_KEY, 'session-1' ],
			createLoadedSession()
		);
		renderWithAgentRun( queryClient );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		startOldRun();
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );

		exitOldRun();

		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalled() );
	} );

	it( 'winds down on Stop, force-stops on a second Stop, and queues until the run exits', async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData< LoadedAiSession >(
			[ ...SESSIONS_QUERY_KEY, 'session-1' ],
			createLoadedSession()
		);
		renderWithAgentRun( queryClient );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		startOldRun();

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		await waitFor( () =>
			expect( screen.getByTestId( 'interrupting' ) ).toHaveTextContent( 'true' )
		);
		expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		await waitFor( () => expect( connector.interruptAgentRun ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.continueSession ).not.toHaveBeenCalled();

		exitOldRun( 'run.interrupted' );

		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalled() );
	} );

	it( 'puts the questions back when an answer fails to send', async () => {
		connector.answerAgentQuestion = vi.fn().mockRejectedValue( new Error( 'lost' ) );
		renderWithAgentRun( createQueryClient() );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
		startOldRun();
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'question.asked',
					timestamp: '2026-06-24T12:00:01.000Z',
					questions: [ { question: 'Q1', options: [ { label: 'A1', description: '' } ] } ],
				},
			} );
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );

		await waitFor( () => expect( connector.answerAgentQuestion ).toHaveBeenCalled() );
		await waitFor( () => expect( screen.getByTestId( 'questions' ) ).toHaveTextContent( 'Q1' ) );
	} );

	it( 'streams a reply into one entry, holding back tool calls until it ends', async () => {
		const queryClient = createQueryClient();
		const key = [ ...SESSIONS_QUERY_KEY, 'session-1' ];
		queryClient.setQueryData< LoadedAiSession >( key, createLoadedSession() );
		renderWithAgentRun( queryClient );
		await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );

		const text = ( value: string ) => ( { type: 'text', text: value } );
		const toolCall = { type: 'toolCall', id: 'call-1', name: 'Edit', arguments: {} };
		const emit = ( type: 'message_update' | 'message_end', content: unknown[] ) =>
			act( () =>
				agentListener( {
					sessionId: 'session-1',
					runId: 'run-1',
					event: {
						type: 'message',
						timestamp: '2026-06-24T12:00:00.000Z',
						message: { type, message: { role: 'assistant', content } },
					},
				} as unknown as AgentRunEvent )
			);
		const contents = () =>
			queryClient
				.getQueryData< LoadedAiSession >( key )!
				.entries.map( ( entry ) => ( entry as { message: { content: unknown } } ).message.content );

		emit( 'message_update', [ text( 'Upd' ) ] );
		emit( 'message_update', [ text( 'Updating' ) ] );
		emit( 'message_update', [ text( 'Updating the header' ), toolCall ] );
		expect( contents() ).toEqual( [ [ text( 'Upd' ) ] ] );
		await waitFor( () => expect( contents() ).toEqual( [ [ text( 'Updating the header' ) ] ] ) );

		emit( 'message_end', [ text( 'Updating the header.' ), toolCall ] );
		expect( contents() ).toEqual( [ [ text( 'Updating the header.' ), toolCall ] ] );
	} );
} );
