import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { AgentRunProvider, useAgentRun } from '@/data/queries/use-agent-run';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import type { Connector, LoadedAiSession, SessionEntry, StudioChatImage } from '@/data/core';
import type { LiveAgentEvents } from '@/data/queries/use-agent-run';

const SESSION_ID = 'session-1';
const SESSION_KEY = [ ...SESSIONS_QUERY_KEY, SESSION_ID ];

const existingEntry = {
	type: 'message',
	id: 'existing-entry',
	parentId: null,
	timestamp: '2026-01-01T00:00:00.000Z',
	message: { role: 'user', content: [ { type: 'text', text: 'earlier message' } ] },
} as unknown as SessionEntry;

const image: StudioChatImage = {
	id: 'image-1',
	name: 'screenshot.png',
	mimeType: 'image/png',
	size: 10,
	dataBase64: 'aGVsbG8=',
};

function renderAgentRun( connector: Connector ) {
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	queryClient.setQueryData< LoadedAiSession >( SESSION_KEY, {
		summary: { id: SESSION_ID } as LoadedAiSession[ 'summary' ],
		entries: [ existingEntry ],
	} );

	const agentRun: { current: LiveAgentEvents | null } = { current: null };
	function Probe() {
		agentRun.current = useAgentRun( SESSION_ID );
		return null;
	}

	render(
		<QueryClientProvider client={ queryClient }>
			<ConnectorProvider connector={ connector }>
				<AgentRunProvider>
					<Probe />
				</AgentRunProvider>
			</ConnectorProvider>
		</QueryClientProvider>
	);

	return { queryClient, agentRun };
}

function createConnector( overrides: Partial< Connector > = {} ): Connector {
	return {
		getActiveAgentRuns: vi.fn().mockResolvedValue( [] ),
		onAgentEvent: vi.fn( () => vi.fn() ),
		...overrides,
	} as unknown as Connector;
}

describe( 'useAgentRun optimistic entry cleanup', () => {
	it( 'removes optimistic entries by id when a concurrent update recreated the cached entries', async () => {
		let rejectSend: ( error: Error ) => void = () => {};
		const connector = createConnector( {
			continueSession: vi.fn(
				() =>
					new Promise< { runId: string } >( ( _resolve, reject ) => {
						rejectSend = reject;
					} )
			),
		} );
		const { queryClient, agentRun } = renderAgentRun( connector );

		await act( async () => {
			const sendPromise = agentRun.current
				?.sendMessage( 'hello', { images: [ image ] } )
				.catch( () => {} );

			// Simulate a refetch settling mid-send: same ids, new object and
			// array identities, so reference-based matching would fail.
			await Promise.resolve();
			queryClient.setQueryData< LoadedAiSession >( SESSION_KEY, ( prev ) =>
				prev ? { ...prev, entries: prev.entries.map( ( entry ) => ( { ...entry } ) ) } : prev
			);

			rejectSend( new Error( 'send failed' ) );
			await sendPromise;
		} );

		const session = queryClient.getQueryData< LoadedAiSession >( SESSION_KEY );
		expect( session?.entries ).toHaveLength( 1 );
		expect( session?.entries[ 0 ].id ).toBe( 'existing-entry' );
		expect( agentRun.current?.error ).toBe( 'send failed' );
	} );
} );
