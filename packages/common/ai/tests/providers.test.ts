import { describe, expect, it } from 'vitest';
import { resolveSessionProvider } from '../providers';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

function sessionContextEntry( provider: string ): SessionEntry {
	return {
		type: 'custom',
		id: 'x',
		parentId: null,
		timestamp: '2026-01-01T00:00:00.000Z',
		customType: 'studio.session_context',
		data: { provider, model: 'claude-sonnet-5' },
	} as unknown as SessionEntry;
}

describe( 'resolveSessionProvider', () => {
	it( 'returns undefined for a session that never recorded a provider', () => {
		expect( resolveSessionProvider( [] ) ).toBeUndefined();
	} );

	it( 'returns the most recently recorded provider', () => {
		const entries = [ sessionContextEntry( 'wpcom' ), sessionContextEntry( 'anthropic-api-key' ) ];

		expect( resolveSessionProvider( entries ) ).toBe( 'anthropic-api-key' );
	} );

	it( 'skips entries carrying a provider we no longer know', () => {
		const entries = [ sessionContextEntry( 'wpcom' ), sessionContextEntry( 'claude-code' ) ];

		expect( resolveSessionProvider( entries ) ).toBe( 'wpcom' );
	} );
} );
