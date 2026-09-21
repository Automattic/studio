import { describe, expect, it } from 'vitest';
import {
	getEffectiveSessionProvider,
	isUiSelectableProvider,
	resolveSessionModelForProvider,
} from '../providers';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

function sessionContext( data: { provider?: string; model?: string } ): SessionEntry {
	return {
		type: 'custom',
		id: 'entry-1',
		parentId: null,
		timestamp: new Date().toISOString(),
		customType: 'studio.session_context',
		data,
	} as unknown as SessionEntry;
}

describe( 'getEffectiveSessionProvider', () => {
	it( 'keeps an openai-compatible pin without an Anthropic key', () => {
		// The pin is configured through the CLI, which runs every turn — so it
		// must be reported, not silently swapped for the default.
		const entries = [ sessionContext( { provider: 'openai-compatible' } ) ];
		expect(
			getEffectiveSessionProvider( entries, {
				provider: 'wpcom',
				hasAnthropicApiKey: false,
			} )
		).toBe( 'openai-compatible' );
	} );

	it( 'drops an anthropic-api-key pin when the key is gone', () => {
		const entries = [ sessionContext( { provider: 'anthropic-api-key' } ) ];
		expect(
			getEffectiveSessionProvider( entries, { provider: 'wpcom', hasAnthropicApiKey: false } )
		).toBe( 'wpcom' );
	} );

	it( 'falls back to the saved selection when nothing is pinned', () => {
		expect(
			getEffectiveSessionProvider( [], { provider: 'wpcom', hasAnthropicApiKey: true } )
		).toBe( 'wpcom' );
		expect( getEffectiveSessionProvider( [], null ) ).toBe( 'wpcom' );
	} );
} );

describe( 'isUiSelectableProvider', () => {
	it( 'excludes only the CLI-configured provider', () => {
		expect( isUiSelectableProvider( 'wpcom' ) ).toBe( true );
		expect( isUiSelectableProvider( 'anthropic-api-key' ) ).toBe( true );
		expect( isUiSelectableProvider( 'openai-compatible' ) ).toBe( false );
	} );
} );

describe( 'resolveSessionModelForProvider', () => {
	it( 'keeps a local endpoint model verbatim', () => {
		const entries = [ sessionContext( { provider: 'openai-compatible', model: 'qwen3.6-27b' } ) ];
		expect( resolveSessionModelForProvider( entries, 'openai-compatible' ) ).toBe( 'qwen3.6-27b' );
	} );

	it( 'snaps a model the provider cannot serve to its default', () => {
		const entries = [ sessionContext( { provider: 'wpcom', model: 'claude-opus-5' } ) ];
		expect( resolveSessionModelForProvider( entries, 'wpcom' ) ).toBe( 'fast' );
	} );

	it( 'upgrades the wpcom default with paid credits', () => {
		expect( resolveSessionModelForProvider( [], 'wpcom', { hasPaidAiCredits: true } ) ).toBe(
			'balanced'
		);
	} );
} );
