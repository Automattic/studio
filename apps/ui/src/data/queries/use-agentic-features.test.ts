import { describe, expect, it } from 'vitest';
import { deriveAgenticFeatures } from './use-agentic-features';
import type { AuthUser } from '@/data/core';

const USER: AuthUser = { id: 1, email: 'ada@example.com', displayName: 'Ada Lovelace' };

describe( 'deriveAgenticFeatures', () => {
	it( 'always enables features when the connector cannot opt out (hosted mode)', () => {
		expect( deriveAgenticFeatures( { supportsAgenticOptOut: false }, null, undefined ) ).toEqual( {
			enabled: true,
			chatEnabled: true,
			reason: null,
		} );
	} );

	it( 'gates signed-out users', () => {
		expect(
			deriveAgenticFeatures( { supportsAgenticOptOut: true }, null, {
				agenticFeaturesEnabled: true,
			} )
		).toEqual( { enabled: false, chatEnabled: false, reason: 'signed-out' } );
	} );

	it( 'disables only chat when signed-in users disable the preference', () => {
		expect(
			deriveAgenticFeatures( { supportsAgenticOptOut: true }, USER, {
				agenticFeaturesEnabled: false,
			} )
		).toEqual( { enabled: true, chatEnabled: false, reason: null } );
		expect(
			deriveAgenticFeatures( { supportsAgenticOptOut: false }, null, {
				agenticFeaturesEnabled: false,
			} )
		).toEqual( { enabled: true, chatEnabled: false, reason: null } );
	} );

	it( 'enables features for signed-in users, treating a missing preference as enabled', () => {
		expect( deriveAgenticFeatures( { supportsAgenticOptOut: true }, USER, undefined ) ).toEqual( {
			enabled: true,
			chatEnabled: true,
			reason: null,
		} );
		expect(
			deriveAgenticFeatures( { supportsAgenticOptOut: true }, USER, {
				agenticFeaturesEnabled: true,
			} )
		).toEqual( { enabled: true, chatEnabled: true, reason: null } );
	} );

	it( 'disables backend features and chat while offline', () => {
		expect(
			deriveAgenticFeatures(
				{ supportsAgenticOptOut: false },
				null,
				{ agenticFeaturesEnabled: true },
				true
			)
		).toEqual( { enabled: false, chatEnabled: false, reason: 'offline' } );
	} );
} );
