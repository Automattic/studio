import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { SESSIONS_QUERY_KEY, useCreateSession, useSessions } from './use-sessions';
import type { AiSessionSummary, Connector } from '@/data/core';

function createSummary(
	id: string,
	overrides: Partial< AiSessionSummary > = {}
): AiSessionSummary {
	return {
		id,
		filePath: `/tmp/${ id }.jsonl`,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		activeEnvironment: 'local',
		eventCount: 0,
		...overrides,
	};
}

function createWrapper( connector: Connector, queryClient: QueryClient ) {
	return function Wrapper( { children }: { children: ReactNode } ) {
		return createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement( ConnectorProvider, { connector, children } )
		);
	};
}

describe( 'useCreateSession', () => {
	it( 'waits for the sessions query to refetch after creating a session', async () => {
		const createdSession = createSummary( 'new-session', {
			updatedAt: '2026-01-01T00:00:00.000Z',
		} );
		const refetchedSession = createSummary( 'new-session', {
			updatedAt: '2026-01-01T00:00:01.000Z',
		} );
		const connector = {
			createSession: vi.fn().mockResolvedValue( createdSession ),
			getSessions: vi
				.fn()
				.mockResolvedValueOnce( [] )
				.mockResolvedValueOnce( [ refetchedSession ] ),
		} as unknown as Connector;
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );

		const { result } = renderHook(
			() => ( {
				createSession: useCreateSession(),
				sessions: useSessions(),
			} ),
			{ wrapper: createWrapper( connector, queryClient ) }
		);

		await waitFor( () => expect( result.current.sessions.data ).toEqual( [] ) );

		await act( async () => {
			await result.current.createSession.mutateAsync( undefined );
		} );

		expect( queryClient.getQueryData( SESSIONS_QUERY_KEY ) ).toEqual( [ refetchedSession ] );
		await waitFor( () => expect( result.current.sessions.data ).toEqual( [ refetchedSession ] ) );
	} );
} );
