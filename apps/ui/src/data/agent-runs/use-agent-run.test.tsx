import { SKIPPED_QUESTION, STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createLocalConnector } from '@/data/core/connectors/local';
import { ASSISTANT_QUOTA_QUERY_KEY } from '@/data/queries/use-assistant-quota';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { createFakeConnector, makeSession, type FakeConnector } from '@/test/fake-connector';
import { createTestQueryClient, renderWithProviders } from '@/test/render';
import { useAgentRun, useSiteAgentActivity } from './use-agent-run';
import type { AgentRunEvent, Connector, LoadedAiSession } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

type Runs = Awaited< ReturnType< Connector[ 'getActiveAgentRuns' ] > >;

function Harness() {
	const run = useAgentRun( 'session-1' );
	const activity = useSiteAgentActivity( [ 'session-1' ] );
	return (
		<>
			<span data-testid="activity">{ activity }</span>
			<span data-testid="phase">{ run.hasActiveRun ? 'active' : 'idle' }</span>
			<span data-testid="started-at">{ run.startedAt ?? 'none' }</span>
			<button onClick={ () => void run.sendMessage( 'Queued follow-up' ).catch( () => {} ) }>
				Queue
			</button>
			<button onClick={ () => run.answerQuestion( 'Q1', 'A1' ) }>Answer Q1</button>
			<button onClick={ () => run.answerQuestion( 'Q2', SKIPPED_QUESTION ) }>Skip Q2</button>
			<button onClick={ () => void run.interrupt() }>Stop</button>
		</>
	);
}

function session(): LoadedAiSession {
	return { summary: makeSession( { id: 'session-1' } ), entries: [] };
}

async function setup(
	{
		connector = createFakeConnector( { sessions: [ session() ] } ),
		queryClient = createTestQueryClient(),
	}: { connector?: FakeConnector; queryClient?: QueryClient } = {},
	ui = <Harness />
) {
	const view = renderWithProviders( ui, { connector, queryClient } );
	await waitFor( () => expect( connector.listenerCount( 'onAgentEvent' ) ).toBeGreaterThan( 0 ) );
	return { ...view, connector, queryClient };
}

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	const promise = new Promise< T >( ( accept ) => {
		resolve = accept;
	} );
	return { promise, resolve };
}

const event = ( runId: string, payload: AgentRunEvent[ 'event' ] ): AgentRunEvent => ( {
	sessionId: 'session-1',
	runId,
	event: payload,
} );
const started = ( runId: string, timestamp = new Date().toISOString() ) =>
	event( runId, { type: 'run.started', timestamp } );
const exited = ( runId: string ) =>
	event( runId, {
		type: 'run.exited',
		timestamp: new Date().toISOString(),
		status: 'success',
		code: 0,
	} as AgentRunEvent[ 'event' ] );
const phase = () => screen.getByTestId( 'phase' );

describe( 'useAgentRun queued handoff', () => {
	it( 'hydrates an existing run when streaming starts before the snapshot arrives', async () => {
		const snapshot = deferred< Runs >();
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.getActiveAgentRuns.mockReturnValue( snapshot.promise );
		await setup( { connector } );
		act( () =>
			connector.emit(
				'onAgentEvent',
				event( 'existing-run', {
					type: 'message',
					timestamp: new Date().toISOString(),
					message: {
						type: 'message_update',
						message: { role: 'assistant', content: [ { type: 'text', text: 'Still working' } ] },
					},
				} as AgentRunEvent[ 'event' ] )
			)
		);
		await act( async () =>
			snapshot.resolve( [
				{ sessionId: 'session-1', runId: 'existing-run', startedAt: 1, phase: 'running' },
			] as Runs )
		);
		expect( phase() ).toHaveTextContent( 'active' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		expect( connector.continueSession ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		await waitFor( () =>
			expect( connector.interruptAgentRun ).toHaveBeenCalledWith( 'existing-run' )
		);
	} );

	it( 'reconciles a completed run after the browser event stream reconnects', async () => {
		const streams: MockStream[] = [];
		class MockStream extends EventTarget {
			onmessage: ( ( event: MessageEvent ) => void ) | null = null;
			onopen: ( ( event: Event ) => void ) | null = null;
			onerror: ( ( event: Event ) => void ) | null = null;
			close() {}
			constructor() {
				super();
				streams.push( this );
			}
			emit( streamEvent: Event ) {
				this.dispatchEvent( streamEvent );
				if ( streamEvent.type === 'open' ) this.onopen?.( streamEvent );
				if ( streamEvent.type === 'error' ) this.onerror?.( streamEvent );
				if ( streamEvent.type === 'message' ) this.onmessage?.( streamEvent as MessageEvent );
			}
		}
		vi.stubGlobal( 'EventSource', MockStream );
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => new Response( JSON.stringify( [] ) ) )
		);
		const local = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );
		await local.init?.();
		const stream = streams[ 0 ];
		const connector = createFakeConnector(
			{ sessions: [ session() ] },
			{
				getActiveAgentRuns: local.getActiveAgentRuns,
				onAgentEvent: local.onAgentEvent,
				onConnectionRestored: local.onConnectionRestored,
			}
		);
		try {
			renderWithProviders( <Harness />, { connector } );
			await waitFor( () => expect( connector.onAgentEvent ).toHaveBeenCalled() );
			stream.emit( new Event( 'open' ) );
			act( () =>
				stream.emit(
					new MessageEvent( 'message', {
						data: JSON.stringify( { channel: 'agent', payload: started( 'run-old' ) } ),
					} )
				)
			);
			expect( phase() ).toHaveTextContent( 'active' );
			act( () => {
				stream.emit( new Event( 'error' ) );
				stream.emit( new Event( 'open' ) );
			} );
			await waitFor( () => expect( phase() ).toHaveTextContent( 'idle' ) );
		} finally {
			vi.unstubAllGlobals();
		}
	} );

	it( 'does not resurrect an exited run from a delayed initial snapshot', async () => {
		const snapshot = deferred< Runs >();
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.getActiveAgentRuns.mockReturnValue( snapshot.promise );
		await setup( { connector } );
		act( () => {
			connector.emit( 'onAgentEvent', started( 'run-old' ) );
			connector.emit( 'onAgentEvent', exited( 'run-old' ) );
		} );
		await act( async () =>
			snapshot.resolve( [
				{ sessionId: 'session-1', runId: 'run-old', startedAt: Date.now(), phase: 'running' },
			] as Runs )
		);
		expect( phase() ).toHaveTextContent( 'idle' );
	} );

	it( 'keeps a newer live run when an older snapshot arrives', async () => {
		const snapshot = deferred< Runs >();
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.getActiveAgentRuns.mockReturnValue( snapshot.promise );
		await setup( { connector } );
		act( () => connector.emit( 'onAgentEvent', started( 'new-run' ) ) );
		await act( async () =>
			snapshot.resolve( [
				{
					sessionId: 'session-1',
					runId: 'old-run',
					startedAt: 1,
					phase: 'running',
					pendingQuestions: [],
				},
			] as Runs )
		);
		act( () => connector.emit( 'onAgentEvent', exited( 'new-run' ) ) );
		expect( phase() ).toHaveTextContent( 'idle' );
	} );

	it( 'dispatches queued follow-ups after reconnecting and refreshes the transcript', async () => {
		const { connector, queryClient } = await setup();
		act( () => connector.emit( 'onAgentEvent', started( 'run-old' ) ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		expect( connector.continueSession ).not.toHaveBeenCalled();
		const invalidate = vi.spyOn( queryClient, 'invalidateQueries' );
		await act( async () => connector.emit( 'onConnectionRestored' ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( invalidate ).toHaveBeenCalledWith(
			{ queryKey: SESSIONS_QUERY_KEY },
			{ cancelRefetch: false }
		);
		expect( invalidate ).toHaveBeenCalledWith( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
	} );

	it( 'ignores a snapshot that lands after a newer one', async () => {
		const { connector } = await setup();
		const older = deferred< Runs >();
		const newer = deferred< Runs >();
		connector.getActiveAgentRuns
			.mockReturnValueOnce( older.promise )
			.mockReturnValueOnce( newer.promise );
		act( () => {
			connector.emit( 'onConnectionRestored' );
			connector.emit( 'onConnectionRestored' );
		} );
		await act( async () => newer.resolve( [] ) );
		await act( async () =>
			older.resolve( [
				{ sessionId: 'session-1', runId: 'run-1', startedAt: 1, phase: 'running' },
			] as Runs )
		);
		expect( phase() ).toHaveTextContent( 'idle' );
	} );

	it( 'dispatches skipped questions with the other answers without stopping the run', async () => {
		const { connector } = await setup();
		act( () => {
			connector.emit( 'onAgentEvent', started( 'run-old' ) );
			connector.emit(
				'onAgentEvent',
				event( 'run-old', {
					type: 'question.asked',
					timestamp: '2026-06-24T12:00:01.000Z',
					questions: [
						{ question: 'Q1', options: [ { label: 'A1', description: '' } ] },
						{ question: 'Q2', options: [ { label: 'A2', description: '' } ] },
					],
				} as AgentRunEvent[ 'event' ] )
			);
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );
		expect( connector.answerAgentQuestion ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Skip Q2' } ) );
		await waitFor( () =>
			expect( connector.answerAgentQuestion ).toHaveBeenCalledWith( 'run-old', {
				Q1: 'A1',
				Q2: SKIPPED_QUESTION,
			} )
		);
		expect( connector.interruptAgentRun ).not.toHaveBeenCalled();
	} );

	it( 'recovers questions asked during a lost connection', async () => {
		const { connector } = await setup();
		connector.getActiveAgentRuns.mockResolvedValue( [
			{
				sessionId: 'session-1',
				runId: 'run-old',
				startedAt: 1,
				phase: 'running',
				pendingQuestions: [ { question: 'Q1', options: [ { label: 'A1', description: '' } ] } ],
			},
		] as Runs );
		await act( async () => connector.emit( 'onConnectionRestored' ) );
		await waitFor( () =>
			expect( screen.getByTestId( 'activity' ) ).toHaveTextContent( 'pending-question' )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );
		await waitFor( () =>
			expect( connector.answerAgentQuestion ).toHaveBeenCalledWith( 'run-old', { Q1: 'A1' } )
		);
	} );

	it( 'does not invalidate the session cache between an old run ending and a queued prompt starting', async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, 'session-1' ], session() );
		const invalidateSpy = vi.spyOn( queryClient, 'invalidateQueries' );
		const { connector } = await setup( { queryClient } );
		act( () => connector.emit( 'onAgentEvent', started( 'run-old', '2026-06-24T12:00:00.000Z' ) ) );
		await waitFor( () => expect( phase() ).toHaveTextContent( 'active' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		act( () => connector.emit( 'onAgentEvent', exited( 'run-old' ) ) );
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
		expect( invalidateSpy ).toHaveBeenCalledWith( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
		expect(
			queryClient
				.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
				?.entries.some( ( entry ) => {
					if ( entry.type !== 'custom' || entry.customType !== 'studio.user_prompt' ) {
						return false;
					}
					return ( entry.data as { text?: string } ).text === 'Queued follow-up';
				} )
		).toBe( true );
	} );

	it.each( [ 'wpcom', 'anthropic-api-key' ] as const )(
		'only holds WordPress.com queues when credits run out: %s',
		async ( provider ) => {
			const connector = createFakeConnector(
				{ sessions: [ session() ] },
				{
					getAiSettings: async () => ( {
						provider,
						hasAnthropicApiKey: true,
						anthropicApiKeyPreview: 'test',
					} ),
				}
			);
			const queryClient = createTestQueryClient();
			await setup( { connector, queryClient } );
			act( () => connector.emit( 'onAgentEvent', started( 'run-old' ) ) );
			await waitFor( () => expect( phase() ).toHaveTextContent( 'active' ) );
			fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
			act( () => {
				queryClient.setQueryData( ASSISTANT_QUOTA_QUERY_KEY, {
					costCap: 100,
					costUsage: 100,
					allowanceRemaining: 0,
					purchasedRemaining: 0,
					hasPaymentMethod: true,
				} );
			} );
			connector.getStudioAssistantQuota.mockResolvedValue( {
				costCap: 100,
				costUsage: 100,
				allowanceRemaining: 0,
				purchasedRemaining: 0,
				hasPaymentMethod: true,
			} as never );
			act( () => connector.emit( 'onAgentEvent', exited( 'run-old' ) ) );
			if ( provider === 'wpcom' ) {
				await waitFor( () => expect( phase() ).toHaveTextContent( 'idle' ) );
				expect( connector.continueSession ).not.toHaveBeenCalled();
			} else {
				await waitFor( () =>
					expect( connector.continueSession ).toHaveBeenCalledWith(
						'session-1',
						'Queued follow-up',
						expect.anything()
					)
				);
			}
		}
	);

	it( 'restores unanswered questions when attaching to an already waiting run', async () => {
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.getActiveAgentRuns.mockResolvedValueOnce( [
			{
				sessionId: 'session-1',
				runId: 'waiting-run',
				startedAt: Date.now(),
				phase: 'running',
				pendingQuestions: [ { question: 'Q1', options: [ { label: 'A1', description: '' } ] } ],
			},
		] as Runs );
		await setup( { connector } );
		await waitFor( () =>
			expect( screen.getByTestId( 'activity' ) ).toHaveTextContent( 'pending-question' )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );
		await waitFor( () =>
			expect( connector.answerAgentQuestion ).toHaveBeenCalledWith( 'waiting-run', { Q1: 'A1' } )
		);
		await waitFor( () =>
			expect( screen.getByTestId( 'activity' ) ).toHaveTextContent( 'working' )
		);
	} );

	it( 'closes a blocked question batch before it interrupts', async () => {
		const { connector } = await setup();
		act( () => {
			connector.emit( 'onAgentEvent', started( 'run-old', '2026-06-24T12:00:00.000Z' ) );
			connector.emit(
				'onAgentEvent',
				event( 'run-old', {
					type: 'question.asked',
					timestamp: '2026-06-24T12:00:01.000Z',
					questions: [
						{ question: 'Q1', options: [ { label: 'A1', description: '' } ] },
						{ question: 'Q2', options: [ { label: 'A2', description: '' } ] },
					],
				} as AgentRunEvent[ 'event' ] )
			);
		} );
		await waitFor( () => expect( phase() ).toHaveTextContent( 'active' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		await waitFor( () =>
			expect( connector.answerAgentQuestion ).toHaveBeenCalledWith( 'run-old', {
				Q1: 'A1',
				Q2: STOPPED_WITHOUT_ANSWER,
			} )
		);
		await waitFor( () => expect( connector.interruptAgentRun ).toHaveBeenCalled() );
		expect( connector.answerAgentQuestion.mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			connector.interruptAgentRun.mock.invocationCallOrder[ 0 ]
		);
	} );

	it( 'keeps force stop available and holds queued messages until the interrupted process exits', async () => {
		const { connector } = await setup();
		act( () => connector.emit( 'onAgentEvent', started( 'run-old' ) ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		await waitFor( () => expect( connector.interruptAgentRun ).toHaveBeenCalledTimes( 1 ) );
		expect( phase() ).toHaveTextContent( 'active' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		await waitFor( () => expect( connector.interruptAgentRun ).toHaveBeenCalledTimes( 2 ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		expect( connector.continueSession ).not.toHaveBeenCalled();
		act( () =>
			connector.emit(
				'onAgentEvent',
				event( 'run-old', { type: 'run.interrupted', timestamp: new Date().toISOString() } )
			)
		);
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
	} );

	it( 'interrupts without answering anything when no questions are open', async () => {
		const { connector } = await setup();
		act( () => connector.emit( 'onAgentEvent', started( 'run-old' ) ) );
		await waitFor( () => expect( phase() ).toHaveTextContent( 'active' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		await waitFor( () => expect( connector.interruptAgentRun ).toHaveBeenCalledWith( 'run-old' ) );
		expect( connector.answerAgentQuestion ).not.toHaveBeenCalled();
	} );

	it( 'leaves a running turn alone when no questions are pending', async () => {
		const { connector } = await setup();
		act( () => connector.emit( 'onAgentEvent', started( 'run-old' ) ) );
		await waitFor( () => expect( phase() ).toHaveTextContent( 'active' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		await waitFor( () => expect( phase() ).toHaveTextContent( 'active' ) );
		expect( connector.interruptAgentRun ).not.toHaveBeenCalled();
		expect( connector.answerAgentQuestion ).not.toHaveBeenCalled();
	} );

	it( 'still invalidates when a run ends without a queued follow-up', async () => {
		const queryClient = createTestQueryClient();
		const invalidateSpy = vi.spyOn( queryClient, 'invalidateQueries' );
		const { connector } = await setup( { queryClient } );
		act( () => {
			connector.emit( 'onAgentEvent', started( 'run-old' ) );
			connector.emit( 'onAgentEvent', exited( 'run-old' ) );
		} );
		expect( invalidateSpy ).toHaveBeenCalledWith(
			{ queryKey: SESSIONS_QUERY_KEY },
			{ cancelRefetch: false }
		);
		expect( invalidateSpy ).toHaveBeenCalledWith( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
	} );

	it( 'preserves the optimistic start time when the backend acknowledges the run', async () => {
		const start = deferred< { runId: string } >();
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.continueSession.mockReturnValue( start.promise );
		await setup( { connector } );
		const nowSpy = vi.spyOn( Date, 'now' ).mockReturnValue( 1_000 );
		try {
			fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
			await waitFor( () =>
				expect( screen.getByTestId( 'started-at' ) ).toHaveTextContent( '1000' )
			);
			nowSpy.mockReturnValue( 2_000 );
			await act( async () => start.resolve( { runId: 'run-next' } ) );
			expect( screen.getByTestId( 'started-at' ) ).toHaveTextContent( '1000' );
			act( () =>
				connector.emit( 'onAgentEvent', started( 'run-next', '1970-01-01T00:00:03.000Z' ) )
			);
			expect( screen.getByTestId( 'started-at' ) ).toHaveTextContent( '1000' );
		} finally {
			nowSpy.mockRestore();
		}
	} );

	it( 'preserves assistant steps across streamed messages in a tool loop', async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, 'session-1' ], session() );
		const { connector } = await setup( { queryClient } );
		const emit = ( type: 'message_update' | 'message_end', text: string ) =>
			connector.emit(
				'onAgentEvent',
				event( 'stream-run', {
					type: 'message',
					timestamp: new Date().toISOString(),
					message: { type, message: { role: 'assistant', content: [ { type: 'text', text } ] } },
				} as AgentRunEvent[ 'event' ] )
			);
		act( () => {
			emit( 'message_update', 'Inspecting' );
			emit( 'message_end', 'Inspecting your theme' );
			emit( 'message_update', 'Updating' );
			emit( 'message_update', 'Updating the header' );
			emit( 'message_end', 'Updated the header' );
		} );
		const entries = queryClient.getQueryData< LoadedAiSession >( [
			...SESSIONS_QUERY_KEY,
			'session-1',
		] )!.entries;
		expect( entries ).toHaveLength( 2 );
		expect( new Set( entries.map( ( entry ) => entry.id ) ).size ).toBe( 2 );
		expect( JSON.stringify( entries ) ).toContain( 'Inspecting your theme' );
		expect( JSON.stringify( entries ) ).toContain( 'Updated the header' );
	} );

	it( 'dispatches queued prompts after the chat panel unmounts', async () => {
		function Toggle() {
			const [ shown, setShown ] = useState( true );
			return (
				<>
					<button onClick={ () => setShown( false ) }>Hide chat</button>
					{ shown ? <Harness /> : <div>Preview only</div> }
				</>
			);
		}
		const { connector } = await setup( undefined, <Toggle /> );
		act( () => connector.emit( 'onAgentEvent', started( 'hidden-run' ) ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Hide chat' } ) );
		act( () => connector.emit( 'onAgentEvent', exited( 'hidden-run' ) ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
	} );
	it( 'returns to idle when a run fails to start', async () => {
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.continueSession.mockRejectedValue( new Error( 'offline' ) );
		await setup( { connector } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalled() );
		await waitFor( () => expect( phase() ).toHaveTextContent( 'idle' ) );
	} );

	it( 'stays idle when a run exits before its start is acknowledged', async () => {
		const start = deferred< { runId: string } >();
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.continueSession.mockReturnValue( start.promise );
		await setup( { connector } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalled() );
		act( () => {
			connector.emit( 'onAgentEvent', started( 'run-next' ) );
			connector.emit( 'onAgentEvent', exited( 'run-next' ) );
		} );
		await act( async () => start.resolve( { runId: 'run-next' } ) );
		expect( phase() ).toHaveTextContent( 'idle' );
	} );

	it( 'puts the questions back when an answer fails to send', async () => {
		const connector = createFakeConnector( { sessions: [ session() ] } );
		connector.answerAgentQuestion.mockRejectedValue( new Error( 'lost' ) );
		await setup( { connector } );
		act( () => {
			connector.emit( 'onAgentEvent', started( 'run-old' ) );
			connector.emit(
				'onAgentEvent',
				event( 'run-old', {
					type: 'question.asked',
					timestamp: new Date().toISOString(),
					questions: [ { question: 'Q1', options: [ { label: 'A1', description: '' } ] } ],
				} as AgentRunEvent[ 'event' ] )
			);
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );
		await waitFor( () => expect( connector.answerAgentQuestion ).toHaveBeenCalled() );
		await waitFor( () =>
			expect( screen.getByTestId( 'activity' ) ).toHaveTextContent( 'pending-question' )
		);
	} );

	it( 'streams a reply into one entry, holding back tool calls until it ends', async () => {
		const queryClient = createTestQueryClient();
		const key = [ ...SESSIONS_QUERY_KEY, 'session-1' ];
		queryClient.setQueryData( key, session() );
		const { connector } = await setup( { queryClient } );
		const text = ( value: string ) => ( { type: 'text', text: value } );
		const toolCall = { type: 'toolCall', id: 'call-1', name: 'Edit', arguments: {} };
		const emit = ( type: 'message_update' | 'message_end', content: unknown[] ) =>
			act( () =>
				connector.emit(
					'onAgentEvent',
					event( 'run-1', {
						type: 'message',
						timestamp: new Date().toISOString(),
						message: { type, message: { role: 'assistant', content } },
					} as AgentRunEvent[ 'event' ] )
				)
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
