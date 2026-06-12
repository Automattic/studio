import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { AgentRunProvider, useAgentRun, useIsSessionRunning } from '@/data/queries/use-agent-run';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import type { Connector, LoadedAiSession } from '@/data/core';
import type { LiveAgentEvents } from '@/data/queries/use-agent-run';

const SESSION_ID = 'session-1';
const SESSION_KEY = [ ...SESSIONS_QUERY_KEY, SESSION_ID ];

function createConnector( overrides: Partial< Connector > = {} ): Connector {
	return {
		getActiveAgentRuns: vi.fn().mockResolvedValue( [] ),
		onAgentEvent: vi.fn( () => vi.fn() ),
		...overrides,
	} as unknown as Connector;
}

describe( 'useIsSessionRunning render scoping', () => {
	it( 'does not re-render rows for other sessions when one session starts running', async () => {
		const connector = createConnector( {
			continueSession: vi.fn( () => new Promise< { runId: string } >( () => {} ) ),
		} );

		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false } },
		} );
		queryClient.setQueryData< LoadedAiSession >( SESSION_KEY, {
			summary: { id: SESSION_ID } as LoadedAiSession[ 'summary' ],
			entries: [],
		} );

		const agentRun: { current: LiveAgentEvents | null } = { current: null };
		function Sender() {
			agentRun.current = useAgentRun( SESSION_ID );
			return null;
		}

		const renderCounts: Record< string, number > = {};
		function RunningProbe( { probeSessionId }: { probeSessionId: string } ) {
			renderCounts[ probeSessionId ] = ( renderCounts[ probeSessionId ] ?? 0 ) + 1;
			useIsSessionRunning( probeSessionId );
			return null;
		}

		render(
			<QueryClientProvider client={ queryClient }>
				<ConnectorProvider connector={ connector }>
					<AgentRunProvider>
						<Sender />
						<RunningProbe probeSessionId={ SESSION_ID } />
						<RunningProbe probeSessionId="other-session" />
					</AgentRunProvider>
				</ConnectorProvider>
			</QueryClientProvider>
		);

		const baselineOther = renderCounts[ 'other-session' ];

		await act( async () => {
			void agentRun.current?.sendMessage( 'hello' );
		} );

		// The sending session's row re-rendered; unrelated rows did not.
		expect( agentRun.current?.isRunning ).toBe( true );
		expect( renderCounts[ 'other-session' ] ).toBe( baselineOther );
	} );
} );
