import { describe, expect, it } from 'vitest';
import { normalizeModelEffort, readSessionEffort, validateTurnModelSettings } from './model-effort';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

const context = ( model: string, effort?: string ) =>
	( {
		type: 'custom',
		customType: 'studio.session_context',
		data: { model, effort },
	} ) as SessionEntry;

describe( 'conversation effort', () => {
	it( 'only accepts effort supported by the selected model', () => {
		expect( normalizeModelEffort( 'balanced', 'high' ) ).toBe( 'high' );
		expect( normalizeModelEffort( 'fast', 'high' ) ).toBe( 'default' );
		expect( normalizeModelEffort( 'strong', 'low' ) ).toBe( 'default' );
		expect( normalizeModelEffort( 'balanced', 'max' ) ).toBe( 'default' );
	} );
	it( 'restores the last effort and resets it for legacy model changes', () => {
		expect( readSessionEffort( [ context( 'balanced', 'high' ) ], 'balanced' ) ).toBe( 'high' );
		expect(
			readSessionEffort(
				[
					context( 'balanced', 'high' ),
					{ type: 'model_change', provider: 'studio-wpcom', modelId: 'balanced-2' } as SessionEntry,
				],
				'balanced'
			)
		).toBe( 'high' );
		expect(
			readSessionEffort( [ context( 'balanced', 'high' ), context( 'fast' ) ], 'fast' )
		).toBe( 'default' );
		expect(
			readSessionEffort(
				[
					context( 'balanced', 'high' ),
					{ type: 'model_change', provider: '', modelId: 'balanced' } as SessionEntry,
				],
				'balanced'
			)
		).toBe( 'default' );
		expect( readSessionEffort( [ context( 'balanced', 'not-an-effort' ) ], 'balanced' ) ).toBe(
			'default'
		);
	} );
	it( 'rejects malformed model or effort at the input boundary', () => {
		expect( validateTurnModelSettings( { model: 'balanced', effort: 'high' } ) ).toEqual( {
			model: 'balanced',
			effort: 'high',
		} );
		expect( validateTurnModelSettings( {} ) ).toEqual( { model: undefined, effort: undefined } );
		for ( const value of [
			{ model: 'unknown' },
			{ model: 12 },
			{ effort: 'invented' },
			{ model: 'fast', effort: 'high' },
		] )
			expect( () => validateTurnModelSettings( value ) ).toThrow();
	} );
} );
