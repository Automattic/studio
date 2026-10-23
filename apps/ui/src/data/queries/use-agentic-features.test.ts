import { describe, expect, it } from 'vitest';
import { deriveAgenticFeatures } from './use-agentic-features';
import type { AuthUser } from '@/data/core';

const user = { id: 1, displayName: 'Test', email: 'test@example.com' } as unknown as AuthUser;

describe( 'deriveAgenticFeatures', () => {
	it( 'always enables features when the connector does not gate them on auth', () => {
		for ( const authUser of [ undefined, null, user ] ) {
			expect( deriveAgenticFeatures( { agenticRequiresAuth: false }, authUser ) ).toEqual( {
				enabled: true,
				chatEnabled: true,
				reason: null,
			} );
		}
	} );

	it( 'disables features without a signed-out reason while auth is still loading', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, undefined ) ).toEqual( {
			enabled: false,
			chatEnabled: true,
			reason: null,
		} );
	} );

	it( 'keeps chat on for signed-out users, who can still chat with an Anthropic key', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, null ) ).toEqual( {
			enabled: false,
			chatEnabled: true,
			reason: 'signed-out',
		} );
	} );

	it( 'enables features for signed-in users', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, user ) ).toEqual( {
			enabled: true,
			chatEnabled: true,
			reason: null,
		} );
	} );

	it( 'disables networked features offline but keeps chats open', () => {
		for ( const connector of [ { agenticRequiresAuth: true }, { agenticRequiresAuth: false } ] ) {
			expect( deriveAgenticFeatures( connector, user, true ) ).toEqual( {
				enabled: false,
				chatEnabled: true,
				reason: 'offline',
			} );
		}
	} );

	// Turning agentic features off in Settings → AI only takes chat away.
	// Previews, sync and publishing keep working, so `enabled` stays true.
	it( 'disables only chat when the user switches agentic features off', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, user, false, false ) ).toEqual( {
			enabled: true,
			chatEnabled: false,
			reason: null,
		} );
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, null, false, false ) ).toEqual( {
			enabled: false,
			chatEnabled: false,
			reason: 'signed-out',
		} );
	} );
} );
