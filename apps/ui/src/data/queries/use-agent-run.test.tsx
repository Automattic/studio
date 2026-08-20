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
				<span data-testid="queued">{ run.queuedPrompts.length }</span>
				<button onClick={ () => void run.sendMessage( 'Queued follow-up' ) }>Queue</button>
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
	let connector: Pick<
		Connector,
		'continueSession' | 'getActiveAgentRuns' | 'interruptAgentRun' | 'onAgentEvent'
	>;
	// Held open so tests can decide when the new run's id becomes known.
	let resolveContinueSession: ( () => void ) | null;

	beforeEach( () => {
		resolveContinueSession = null;
		connector = {
			continueSession: vi.fn().mockResolvedValue( { runId: 'run-next' } ),
			getActiveAgentRuns: vi.fn().mockResolvedValue( [] ),
			interruptAgentRun: vi.fn().mockResolvedValue( undefined ),
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

	// Stopping the agent dispatches the queued prompt right away, but the
	// interrupted child keeps winding down and its `run.exited` can land before
	// the replacement run's id is known. Treating that as the current run ending
	// refetched the transcript from disk — before the new child had written the
	// prompt — so the message the user just watched send vanished.
	it( 'keeps a queued prompt when the interrupted run exits mid-start', async () => {
		connector.continueSession = vi.fn(
			() =>
				new Promise( ( resolve ) => {
					resolveContinueSession = () => resolve( { runId: 'run-next' } );
				} )
		);
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
		await waitFor( () => expect( screen.getByTestId( 'queued' ) ).toHaveTextContent( '1' ) );

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		} );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalled() );

		// The interrupted child finally winds down, while the replacement run is
		// still mid-start.
		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: { type: 'run.interrupted', timestamp: '2026-06-24T12:00:02.000Z' },
			} );
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'run.exited',
					timestamp: '2026-06-24T12:00:02.100Z',
					status: 'error',
					code: 143,
				},
			} );
		} );

		await act( async () => {
			resolveContinueSession?.();
		} );

		expect( invalidateSpy ).not.toHaveBeenCalledWith(
			expect.objectContaining( { queryKey: SESSIONS_QUERY_KEY } ),
			expect.anything()
		);
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

	// After a plain Stop the transcript still has to catch up with what the
	// child actually wrote before it exited.
	it( 'refetches when an interrupted run exits with nothing taking its place', async () => {
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

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Stop' } ) );
		} );

		act( () => {
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: { type: 'run.interrupted', timestamp: '2026-06-24T12:00:02.000Z' },
			} );
			agentListener( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'run.exited',
					timestamp: '2026-06-24T12:00:02.100Z',
					status: 'error',
					code: 143,
				},
			} );
		} );

		expect( invalidateSpy ).toHaveBeenCalledWith(
			{ queryKey: SESSIONS_QUERY_KEY },
			{ cancelRefetch: false }
		);
	} );
} );
