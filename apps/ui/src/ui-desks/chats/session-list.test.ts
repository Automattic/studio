import { describe, expect, it } from 'vitest';
import { getDeskSessions } from './index';
import type { AiSessionSummary } from '@/data/core';

function makeSession( id: string, updatedAt: string, ownerSitePath?: string ): AiSessionSummary {
	return {
		id,
		filePath: `/sessions/${ id }.jsonl`,
		createdAt: updatedAt,
		updatedAt,
		ownerSitePath,
		activeEnvironment: 'local',
		eventCount: 1,
	};
}

describe( 'getDeskSessions', () => {
	it( 'returns ownerless user desk sessions newest first', () => {
		const sessions = [
			makeSession( 'older-user', '2026-05-06T12:00:00.000Z' ),
			makeSession( 'site-session', '2026-05-08T12:00:00.000Z', '/Users/riad/Studio/site' ),
			makeSession( 'newer-user', '2026-05-07T12:00:00.000Z' ),
		];

		expect(
			getDeskSessions( sessions, { type: 'user' } ).map( ( session ) => session.id )
		).toEqual( [ 'newer-user', 'older-user' ] );
	} );

	it( 'returns only sessions attached to the current site path', () => {
		const sessions = [
			makeSession( 'other-site', '2026-05-08T12:00:00.000Z', '/Users/riad/Studio/other' ),
			makeSession( 'older-site', '2026-05-06T12:00:00.000Z', '/Users/riad/Studio/site' ),
			makeSession( 'user-session', '2026-05-09T12:00:00.000Z' ),
			makeSession( 'newer-site', '2026-05-07T12:00:00.000Z', '/Users/riad/Studio/site' ),
		];

		expect(
			getDeskSessions( sessions, {
				type: 'site',
				siteId: 'site-id',
				sitePath: '/Users/riad/Studio/site',
			} ).map( ( session ) => session.id )
		).toEqual( [ 'newer-site', 'older-site' ] );
	} );

	it( 'does not show user desk sessions while the site path is still loading', () => {
		const sessions = [ makeSession( 'user-session', '2026-05-08T12:00:00.000Z' ) ];

		expect(
			getDeskSessions( sessions, {
				type: 'site',
				siteId: 'site-id',
				sitePath: undefined,
			} )
		).toEqual( [] );
	} );
} );
