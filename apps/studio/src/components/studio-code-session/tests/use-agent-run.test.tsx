// Run tests: npm test -- src/components/studio-code-session/tests/use-agent-run.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunProvider, useAgentRun } from '../use-agent-run';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { IpcRendererEvent } from 'electron';
import type { PropsWithChildren } from 'react';

const { mockUseIpcListener, ipcApi } = vi.hoisted( () => ( {
	mockUseIpcListener: vi.fn(),
	ipcApi: {
		listActiveAiAgentRuns: vi.fn().mockResolvedValue( [] ),
		continueAiSession: vi.fn(),
		interruptAiAgentRun: vi.fn(),
		answerAiAgentQuestion: vi.fn(),
	},
} ) );

vi.mock( 'src/hooks/use-ipc-listener', () => ( {
	useIpcListener: mockUseIpcListener,
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ipcApi,
} ) );

const SESSION_ID = 'session-1';
const RUN_ID = 'run-1';

function emit( payload: AgentRunEvent ) {
	const listener = mockUseIpcListener.mock.calls.at( -1 )?.[ 1 ];
	if ( ! listener ) {
		throw new Error( 'ai-agent-event listener was not registered' );
	}
	act( () => {
		listener( {} as IpcRendererEvent, payload );
	} );
}

function runEvent( event: AgentRunEvent[ 'event' ] ): AgentRunEvent {
	return { runId: RUN_ID, sessionId: SESSION_ID, event };
}

function renderUseAgentRun() {
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	const wrapper = ( { children }: PropsWithChildren ) => (
		<QueryClientProvider client={ queryClient }>
			<AgentRunProvider>{ children }</AgentRunProvider>
		</QueryClientProvider>
	);
	return renderHook( () => useAgentRun( SESSION_ID ), { wrapper } );
}

beforeEach( () => {
	mockUseIpcListener.mockReset();
	ipcApi.listActiveAiAgentRuns.mockResolvedValue( [] );
} );

describe( 'useAgentRun error surfacing', () => {
	it( 'keeps the error visible after the run exits when a turn fails', async () => {
		const { result } = renderUseAgentRun();

		emit( runEvent( { type: 'run.started', timestamp: new Date().toISOString() } ) );
		emit(
			runEvent( {
				type: 'error',
				timestamp: new Date().toISOString(),
				message: 'API Error: 500 internal server error',
			} )
		);

		expect( result.current.error ).toBe( 'API Error: 500 internal server error' );

		emit(
			runEvent( {
				type: 'turn.completed',
				timestamp: new Date().toISOString(),
				sessionId: SESSION_ID,
				status: 'error',
			} )
		);
		emit(
			runEvent( {
				type: 'run.exited',
				timestamp: new Date().toISOString(),
				status: 'error',
				code: 0,
			} )
		);

		// The subprocess has fully wound down, but the failure stays visible.
		await waitFor( () => expect( result.current.hasActiveRun ).toBe( false ) );
		expect( result.current.error ).toBe( 'API Error: 500 internal server error' );
	} );

	it( 'does not surface an error for a clean run', async () => {
		const { result } = renderUseAgentRun();

		emit( runEvent( { type: 'run.started', timestamp: new Date().toISOString() } ) );
		emit(
			runEvent( {
				type: 'turn.completed',
				timestamp: new Date().toISOString(),
				sessionId: SESSION_ID,
				status: 'success',
			} )
		);
		emit(
			runEvent( {
				type: 'run.exited',
				timestamp: new Date().toISOString(),
				status: 'success',
				code: 0,
			} )
		);

		await waitFor( () => expect( result.current.hasActiveRun ).toBe( false ) );
		expect( result.current.error ).toBeNull();
	} );
} );
