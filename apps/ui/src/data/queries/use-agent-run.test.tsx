import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { useAgentRun } from './use-agent-run';
import type { AgentRunEvent, Connector, LoadedAiSession } from '@/data/core';
import type { ReactNode } from 'react';

function createDeferred< T >() {
	let resolve!: ( value: T ) => void;
	let reject!: ( reason?: unknown ) => void;
	const promise = new Promise< T >( ( promiseResolve, promiseReject ) => {
		resolve = promiseResolve;
		reject = promiseReject;
	} );
	return { promise, resolve, reject };
}

function createSession(): LoadedAiSession {
	return {
		summary: {
			id: 'session-1',
			filePath: '/tmp/session-1.jsonl',
			createdAt: '2026-04-28T00:00:00.000Z',
			updatedAt: '2026-04-28T00:00:00.000Z',
			linkedAgentSessionIds: [],
			activeEnvironment: 'local',
			eventCount: 0,
		},
		events: [],
	};
}

describe( 'useAgentRun', () => {
	it( 'returns to idle on interrupt and starts the next prompt directly', async () => {
		let listener: ( ( event: AgentRunEvent ) => void ) | null = null;
		const continueSession = vi
			.fn()
			.mockResolvedValueOnce( { runId: 'run-1' } )
			.mockResolvedValueOnce( { runId: 'run-2' } );
		const connector = {
			continueSession,
			interruptAgentRun: vi.fn().mockResolvedValue( undefined ),
			onAgentEvent: vi.fn( ( callback: ( event: AgentRunEvent ) => void ) => {
				listener = callback;
				return vi.fn();
			} ),
		} as unknown as Connector;
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, 'session-1' ], createSession() );

		const wrapper = ( { children }: { children: ReactNode } ) => (
			<ConnectorProvider connector={ connector }>
				<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
			</ConnectorProvider>
		);

		const { result } = renderHook( () => useAgentRun( 'session-1' ), { wrapper } );

		await act( async () => {
			await result.current.sendMessage( 'Build a site' );
		} );
		await waitFor( () => expect( result.current.hasActiveRun ).toBe( true ) );

		await act( async () => {
			await result.current.interrupt();
		} );

		expect( connector.interruptAgentRun ).toHaveBeenCalledWith( 'run-1' );
		await waitFor( () => expect( result.current.hasActiveRun ).toBe( false ) );
		expect( result.current.queuedPrompts ).toEqual( [] );
		expect(
			queryClient
				.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
				?.events.some( ( event ) => event.type === 'turn.closed' && event.status === 'interrupted' )
		).toBe( true );

		act( () => {
			listener?.( {
				runId: 'run-1',
				sessionId: 'session-1',
				event: {
					type: 'message',
					timestamp: '2026-04-28T00:00:01.000Z',
					message: { type: 'assistant', message: { content: [] } },
				},
			} );
		} );
		expect(
			queryClient
				.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
				?.events.some( ( event ) => event.type === 'sdk.message' )
		).toBe( false );

		await act( async () => {
			await result.current.sendMessage( 'Try a different layout' );
		} );

		expect( continueSession ).toHaveBeenCalledTimes( 2 );
		expect( continueSession ).toHaveBeenNthCalledWith( 2, 'session-1', 'Try a different layout' );
		expect( result.current.queuedPrompts ).toEqual( [] );
	} );

	it( 'can interrupt while the run id is still being created', async () => {
		const firstRun = createDeferred< { runId: string } >();
		const continueSession = vi
			.fn()
			.mockReturnValueOnce( firstRun.promise )
			.mockResolvedValueOnce( { runId: 'run-2' } );
		const connector = {
			continueSession,
			interruptAgentRun: vi.fn().mockResolvedValue( undefined ),
			onAgentEvent: vi.fn( () => vi.fn() ),
		} as unknown as Connector;
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, 'session-1' ], createSession() );
		const wrapper = ( { children }: { children: ReactNode } ) => (
			<ConnectorProvider connector={ connector }>
				<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
			</ConnectorProvider>
		);

		const { result } = renderHook( () => useAgentRun( 'session-1' ), { wrapper } );

		let sendPromise!: Promise< void >;
		act( () => {
			sendPromise = result.current.sendMessage( 'Build a site' );
		} );
		await waitFor( () => expect( result.current.hasActiveRun ).toBe( true ) );

		await act( async () => {
			await result.current.interrupt();
		} );

		await waitFor( () => expect( result.current.hasActiveRun ).toBe( false ) );
		expect(
			queryClient
				.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
				?.events.some( ( event ) => event.type === 'turn.closed' && event.status === 'interrupted' )
		).toBe( true );
		expect( connector.interruptAgentRun ).not.toHaveBeenCalled();

		await act( async () => {
			firstRun.resolve( { runId: 'run-1' } );
			await sendPromise;
		} );

		expect( connector.interruptAgentRun ).toHaveBeenCalledWith( 'run-1' );

		await act( async () => {
			await result.current.sendMessage( 'Try a different layout' );
		} );

		expect( continueSession ).toHaveBeenCalledTimes( 2 );
		expect( continueSession ).toHaveBeenNthCalledWith( 2, 'session-1', 'Try a different layout' );
		expect( result.current.queuedPrompts ).toEqual( [] );
	} );
} );
