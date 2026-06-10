import { readSharedSessions } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateSessionMetadata } from '../helpers';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readSharedSessions: vi.fn(),
} ) );

const readSharedSessionsMock = vi.mocked( readSharedSessions );

function createSession( id: string ): AiSessionSummary {
	return {
		id,
		filePath: `/tmp/${ id }.jsonl`,
		createdAt: '2026-05-01T00:00:00.000Z',
		updatedAt: '2026-05-01T00:00:00.000Z',
		activeEnvironment: 'local',
		eventCount: 4,
		firstPrompt: 'Build a landing page',
		assistantReplyPreview: 'Added a hero section.',
	};
}

describe( 'hydrateSessionMetadata', () => {
	beforeEach( () => {
		readSharedSessionsMock.mockReset();
	} );

	it( 'hydrates titles and descriptions from shared config, preferring user overrides', async () => {
		readSharedSessionsMock.mockResolvedValue( {
			'session-1': {
				userTitle: 'My custom title',
				generatedTitle: 'Generated title',
				generatedDescription: 'Generated description',
			},
		} );

		const [ session ] = await hydrateSessionMetadata( [ createSession( 'session-1' ) ] );

		expect( session.title ).toBe( 'My custom title' );
		expect( session.description ).toBe( 'Generated description' );
	} );

	it( 'leaves sessions without shared metadata untouched', async () => {
		readSharedSessionsMock.mockResolvedValue( {} );

		const [ session ] = await hydrateSessionMetadata( [ createSession( 'session-1' ) ] );

		expect( session.title ).toBeUndefined();
		expect( session.firstPrompt ).toBe( 'Build a landing page' );
	} );

	it( 'returns sessions unchanged when shared config is unreadable', async () => {
		readSharedSessionsMock.mockRejectedValue( new Error( 'corrupt' ) );

		const sessions = [ createSession( 'session-1' ) ];

		await expect( hydrateSessionMetadata( sessions ) ).resolves.toEqual( sessions );
	} );
} );
