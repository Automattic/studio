import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { openNewSession, primeSessionQueryData, SESSIONS_QUERY_KEY } from './use-sessions';
import type { AiSessionSummary, Connector, LoadedAiSession } from '@/data/core';

describe( 'primeSessionQueryData', () => {
	it( 'upserts the summary into the sessions list newest-first', () => {
		const queryClient = new QueryClient();
		const older = createSummary( { id: 'older', updatedAt: '2026-06-25T12:00:00.000Z' } );
		const newer = createSummary( { id: 'newer', updatedAt: '2026-06-26T12:00:00.000Z' } );

		queryClient.setQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY, [ older ] );

		primeSessionQueryData( queryClient, newer );

		expect(
			queryClient
				.getQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY )
				?.map( ( session ) => session.id )
		).toEqual( [ 'newer', 'older' ] );
	} );

	it( 'seeds an empty loaded session without discarding existing entries', () => {
		const queryClient = new QueryClient();
		const summary = createSummary( { eventCount: 0 } );
		const sessionKey = [ ...SESSIONS_QUERY_KEY, summary.id ];

		primeSessionQueryData( queryClient, summary );
		expect( queryClient.getQueryData< LoadedAiSession >( sessionKey ) ).toEqual( {
			summary,
			entries: [],
		} );

		const entries = [ { type: 'custom', id: 'entry-1' } ] as LoadedAiSession[ 'entries' ];
		queryClient.setQueryData< LoadedAiSession >( sessionKey, { summary, entries } );

		const updatedSummary = createSummary( {
			id: summary.id,
			updatedAt: '2026-06-26T12:00:00.000Z',
			ownerSiteName: 'Updated Site',
		} );
		primeSessionQueryData( queryClient, updatedSummary );

		expect( queryClient.getQueryData< LoadedAiSession >( sessionKey ) ).toEqual( {
			summary: updatedSummary,
			entries,
		} );
	} );

	it( 'does not seed a loaded session shell when the summary already has entries', () => {
		const queryClient = new QueryClient();
		const summary = createSummary( { eventCount: 1 } );

		primeSessionQueryData( queryClient, summary );

		expect(
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, summary.id ] )
		).toBeUndefined();
	} );
} );

describe( 'openNewSession', () => {
	it( 'creates the session on the picked model and primes its cache while the transcript reconciles', async () => {
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn( queryClient, 'invalidateQueries' );
		const summary = createSummary( { eventCount: 0 } );
		const connector = {
			createSession: vi.fn( async () => summary ),
			setSessionModel: vi.fn( async () => undefined ),
		} as unknown as Connector;

		await expect(
			openNewSession( { connector, queryClient }, 'site-1', 'claude-opus-5' )
		).resolves.toBe( summary );

		expect( connector.createSession ).toHaveBeenCalledWith( 'site-1' );
		expect( connector.setSessionModel ).toHaveBeenCalledWith( 'session-1', 'claude-opus-5' );
		expect(
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
		).toEqual( {
			summary,
			entries: [ expect.objectContaining( { type: 'model_change', modelId: 'claude-opus-5' } ) ],
		} );
		expect( invalidateQueries ).toHaveBeenCalledWith( {
			queryKey: SESSIONS_QUERY_KEY,
			exact: true,
		} );
		expect( invalidateQueries ).toHaveBeenCalledWith( {
			queryKey: [ ...SESSIONS_QUERY_KEY, 'session-1' ],
			exact: true,
		} );
	} );
} );

function createSummary( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/tmp/session.jsonl',
		createdAt: '2026-06-26T11:00:00.000Z',
		updatedAt: '2026-06-26T11:00:00.000Z',
		ownerSitePath: '/Users/example/Studio/example-site',
		ownerSiteName: 'Example Site',
		activeEnvironment: 'local',
		eventCount: 1,
		...overrides,
	};
}
