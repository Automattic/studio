import { describe, expect, it } from 'vitest';
import { deriveAgenticFeatures } from './use-agentic-features';
import type { AuthUser } from '@/data/core';

const user = { id: 1, displayName: 'Test', email: 'test@example.com' } as unknown as AuthUser;

describe( 'deriveAgenticFeatures', () => {
	it( 'always enables features when the connector does not gate them on auth', () => {
		const connector = { agenticRequiresAuth: false };
		expect( deriveAgenticFeatures( connector, undefined ) ).toEqual( {
			enabled: true,
			chatEnabled: true,
			reason: null,
		} );
		expect( deriveAgenticFeatures( connector, null ) ).toEqual( {
			enabled: true,
			chatEnabled: true,
			reason: null,
		} );
		expect( deriveAgenticFeatures( connector, user ) ).toEqual( {
			enabled: true,
			chatEnabled: true,
			reason: null,
		} );
	} );

	it( 'disables features without a signed-out reason while auth is still loading', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, undefined ) ).toEqual( {
			enabled: false,
			chatEnabled: false,
			reason: null,
		} );
	} );

	it( 'disables features with a signed-out reason for signed-out users', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, null ) ).toEqual( {
			enabled: false,
			chatEnabled: false,
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

	it( 'disables features with an offline reason regardless of auth state', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, user, true ) ).toEqual( {
			enabled: false,
			chatEnabled: false,
			reason: 'offline',
		} );
		expect( deriveAgenticFeatures( { agenticRequiresAuth: false }, undefined, true ) ).toEqual( {
			enabled: false,
			chatEnabled: false,
			reason: 'offline',
		} );
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, null, true ) ).toEqual( {
			enabled: false,
			chatEnabled: false,
			reason: 'offline',
		} );
	} );

	// Turning agentic features off in Settings → AI only takes chat away.
	// Previews, sync and publishing keep working, so `enabled` stays true.
	it( 'disables only chat when the user switches agentic features off', () => {
		expect( deriveAgenticFeatures( { agenticRequiresAuth: true }, user, false, false ) ).toEqual( {
			enabled: true,
			chatEnabled: false,
			reason: null,
		} );
		expect(
			deriveAgenticFeatures( { agenticRequiresAuth: false }, undefined, false, false )
		).toEqual( {
			enabled: true,
			chatEnabled: false,
			reason: null,
		} );
	} );
} );
