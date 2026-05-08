import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { SESSIONS_QUERY_KEY, upsertSessionSummary } from './use-sessions';
import type { AiSessionSummary } from '@/data/core';

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

describe( 'upsertSessionSummary', () => {
	it( 'adds a session summary when the sessions query has no data yet', () => {
		const queryClient = new QueryClient();
		const session = createSummary( 'new-session' );

		upsertSessionSummary( queryClient, session );

		expect( queryClient.getQueryData( SESSIONS_QUERY_KEY ) ).toEqual( [ session ] );
	} );

	it( 'prepends new summaries and replaces existing summaries by id', () => {
		const queryClient = new QueryClient();
		const existing = createSummary( 'existing-session', { firstPrompt: 'Initial prompt' } );
		queryClient.setQueryData( SESSIONS_QUERY_KEY, [ existing ] );

		const created = createSummary( 'created-session' );
		upsertSessionSummary( queryClient, created );

		expect( queryClient.getQueryData( SESSIONS_QUERY_KEY ) ).toEqual( [ created, existing ] );

		const updatedExisting = createSummary( 'existing-session', { firstPrompt: 'Updated prompt' } );
		upsertSessionSummary( queryClient, updatedExisting );

		expect( queryClient.getQueryData( SESSIONS_QUERY_KEY ) ).toEqual( [
			created,
			updatedExisting,
		] );
	} );
} );
