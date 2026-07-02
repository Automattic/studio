import { describe, expect, it } from 'vitest';
import { deriveAgenticFeatures } from './use-agentic-features';
import type { AuthUser } from '@/data/core';

const USER: AuthUser = { id: 1, email: 'ada@example.com', displayName: 'Ada Lovelace' };

describe( 'deriveAgenticFeatures', () => {
	it( 'always enables features when the connector cannot opt out (hosted mode)', () => {
		expect( deriveAgenticFeatures( { supportsAgenticOptOut: false }, null, undefined ) ).toEqual( {
			enabled: true,
			reason: null,
		} );
	} );

	it( 'gates signed-out users', () => {
		expect(
			deriveAgenticFeatures( { supportsAgenticOptOut: true }, null, {
				agenticFeaturesEnabled: true,
			} )
		).toEqual( { enabled: false, reason: 'signed-out' } );
	} );

	it( 'gates signed-in users who disabled the preference', () => {
		expect(
			deriveAgenticFeatures( { supportsAgenticOptOut: true }, USER, {
				agenticFeaturesEnabled: false,
			} )
		).toEqual( { enabled: false, reason: 'preference' } );
	} );

	it( 'enables features for signed-in users, treating a missing preference as enabled', () => {
		expect( deriveAgenticFeatures( { supportsAgenticOptOut: true }, USER, undefined ) ).toEqual( {
			enabled: true,
			reason: null,
		} );
		expect(
			deriveAgenticFeatures( { supportsAgenticOptOut: true }, USER, {
				agenticFeaturesEnabled: true,
			} )
		).toEqual( { enabled: true, reason: null } );
	} );
} );
