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
				<button onClick={ () => run.answerQuestion( 'Q1', 'A1' ) }>Answer Q1</button>
				<button onClick={ () => run.answerQuestion( 'Q2', 'A2' ) }>Answer Q2</button>
				<button onClick={ () => run.clearQuestionAnswer( 'Q2' ) }>Unanswer Q2</button>
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

describe( 'useAgentRun message queueing', () => {
	beforeEach( () => {
		mockIpc.listActiveAiAgentRuns.mockResolvedValue( [] );
		mockIpc.continueAiSession.mockResolvedValue( { runId: 'run-next' } );
		mockIpc.interruptAiAgentRun.mockResolvedValue( undefined );
		mockIpc.answerAiAgentQuestion.mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	it( 'holds the batch open after a picked option is cleared for a free-form reply', async () => {
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
						{ question: 'Q1', options: [ { label: 'A1', description: '' } ] },
						{ question: 'Q2', options: [ { label: 'A2', description: '' } ] },
					],
				},
			} as AgentRunEvent );
		} );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		// Pick an option for Q2, then arm a free-form reply for it instead.
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q2' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Unanswer Q2' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );

		// Q2 is unanswered again, so the batch must not dispatch the stale pick.
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );
		expect( mockIpc.answerAiAgentQuestion ).not.toHaveBeenCalled();
	} );

	it( 'dispatches once the cleared question is answered again', async () => {
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
						{ question: 'Q1', options: [ { label: 'A1', description: '' } ] },
						{ question: 'Q2', options: [ { label: 'A2', description: '' } ] },
					],
				},
			} as AgentRunEvent );
		} );
		await waitFor( () => expect( screen.getByTestId( 'phase' ) ).toHaveTextContent( 'active' ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q2' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Unanswer Q2' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q1' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Answer Q2' } ) );

		await waitFor( () =>
			expect( mockIpc.answerAiAgentQuestion ).toHaveBeenCalledWith( 'run-old', {
				Q1: 'A1',
				Q2: 'A2',
			} )
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
		expect( mockIpc.answerAiAgentQuestion ).not.toHaveBeenCalled();
		expect( mockIpc.continueAiSession ).not.toHaveBeenCalled();
	} );
} );
