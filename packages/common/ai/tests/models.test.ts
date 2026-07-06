import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, resolveSessionModel } from '../models';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

function modelChangeEntry( modelId: string ): SessionEntry {
	return { type: 'model_change', modelId } as unknown as SessionEntry;
}

describe( 'resolveSessionModel', () => {
	it( 'returns the built-in default for a session with no recorded model', () => {
		expect( resolveSessionModel( [] ) ).toBe( DEFAULT_MODEL );
	} );

	it( 'returns the fallback for a session with no recorded model', () => {
		expect( resolveSessionModel( [], 'claude-opus-4-8' ) ).toBe( 'claude-opus-4-8' );
	} );

	it( 'keeps the recorded model over the fallback', () => {
		expect( resolveSessionModel( [ modelChangeEntry( 'gpt-5.5' ) ], 'claude-opus-4-8' ) ).toBe(
			'gpt-5.5'
		);
	} );

	it( 'falls back when the recorded model is no longer offered', () => {
		expect(
			resolveSessionModel( [ modelChangeEntry( 'claude-retired-1' ) ], 'claude-opus-4-8' )
		).toBe( 'claude-opus-4-8' );
	} );
} );
