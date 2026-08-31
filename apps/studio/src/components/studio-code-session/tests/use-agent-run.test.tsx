// Run tests: npm test -- apps/studio/src/components/studio-code-session/tests/use-agent-run.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from 'src/stores';
import { AgentRunProvider, useAgentRun } from '../use-agent-run';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { ReactNode } from 'react';

const { mockIpc } = vi.hoisted( () => ( {
	mockIpc: {
		listActiveAiAgentRuns: vi.fn(),
		continueAiSession: vi.fn(),
		interruptAiAgentRun: vi.fn(),
		answerAiAgentQuestion: vi.fn(),
	},
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => mockIpc,
} ) );

let agentListener: ( event: unknown, payload: AgentRunEvent ) => void;

vi.mock( 'src/hooks/use-ipc-listener', () => ( {
	useIpcListener: (
		_channel: string,
		listener: ( event: unknown, payload: AgentRunEvent ) => void
	) => {
		agentListener = listener;
	},
} ) );

function emit( payload: AgentRunEvent ) {
	agentListener( null, payload );
}

function renderWithAgentRun() {
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
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		return (
			<Provider store={ store }>
				<QueryClientProvider client={ queryClient }>
					<AgentRunProvider>{ children }</AgentRunProvider>
				</QueryClientProvider>
			</Provider>
		);
	}

	return render( <Harness />, { wrapper: Wrapper } );
}

function startRunEvent(): AgentRunEvent {
	return {
		sessionId: 'session-1',
		runId: 'run-old',
		event: { type: 'run.started', timestamp: '2026-08-26T12:00:00.000Z' },
	} as AgentRunEvent;
}

describe( 'useAgentRun replies while the agent is asking', () => {
	beforeEach( () => {
		mockIpc.listActiveAiAgentRuns.mockResolvedValue( [] );
		mockIpc.continueAiSession.mockResolvedValue( { runId: 'run-next' } );
		mockIpc.interruptAiAgentRun.mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	it( 'cancels pending questions so a reply is not stuck behind a blocked run', async () => {
		renderWithAgentRun();

		act( () => {
			emit( startRunEvent() );
			emit( {
				sessionId: 'session-1',
				runId: 'run-old',
				event: {
					type: 'question.asked',
					timestamp: '2026-08-26T12:00:01.000Z',
					questions: [
						{
							question: 'How should the plugin be structured?',
							options: [ { label: 'Single file plugin', description: 'One file.' } ],
						},
					],
				},
			} as AgentRunEvent );
		} );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );

		// A run blocked on `ask_user` never reaches idle by itself, so without
		// the cancel the queued reply would never be delivered.
		await waitFor( () => expect( mockIpc.interruptAiAgentRun ).toHaveBeenCalledWith( 'run-old' ) );
		await waitFor( () =>
			expect( mockIpc.continueAiSession ).toHaveBeenCalledWith(
				'session-1',
				'Queued follow-up',
				expect.objectContaining( { displayMessage: 'Queued follow-up' } )
			)
		);
	} );

	it( 'leaves a running turn alone when no questions are pending', async () => {
		renderWithAgentRun();

		act( () => {
			emit( startRunEvent() );
		} );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Queue' } ) );

		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );
		expect( mockIpc.interruptAiAgentRun ).not.toHaveBeenCalled();
		expect( mockIpc.continueAiSession ).not.toHaveBeenCalled();
	} );
} );
