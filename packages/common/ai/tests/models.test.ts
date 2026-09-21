import { describe, expect, it } from 'vitest';
import { aiModelSupportsImages, getAiModelFamily, getAiModelLabel, isAiModelId } from '../models';

describe( 'model helpers with arbitrary ids', () => {
	it( 'resolves the family of a built-in model', () => {
		expect( getAiModelFamily( 'claude-sonnet-5' ) ).toBe( 'anthropic' );
		expect( getAiModelFamily( 'fast' ) ).toBe( 'studio' );
	} );

	it( 'defaults an unknown (local) model id to the openai family', () => {
		// A local `openai-compatible` model isn't in AI_MODELS; it must route
		// through the openai credential path rather than crash.
		expect( getAiModelFamily( 'qwen3.6-27b' ) ).toBe( 'openai' );
		expect( getAiModelFamily( 'some-random-local-model' ) ).toBe( 'openai' );
	} );

	it( 'labels a built-in model with its display name', () => {
		expect( getAiModelLabel( 'claude-sonnet-5' ) ).toBe( 'Sonnet 5' );
	} );

	it( 'labels an unknown (local) model with its own id', () => {
		expect( getAiModelLabel( 'qwen3.6-27b' ) ).toBe( 'qwen3.6-27b' );
	} );

	it( 'assumes an unknown (local) model is text-only', () => {
		// Vision drives whether take_screenshot is offered; most local models
		// reject image input, while a built-in that omits the flag takes it.
		expect( aiModelSupportsImages( 'qwen3.6-27b' ) ).toBe( false );
		expect( aiModelSupportsImages( 'claude-sonnet-5' ) ).toBe( true );
		expect( aiModelSupportsImages( 'fast' ) ).toBe( false );
	} );

	it( 'still recognizes only built-in ids as AiModelId', () => {
		expect( isAiModelId( 'claude-sonnet-5' ) ).toBe( true );
		expect( isAiModelId( 'qwen3.6-27b' ) ).toBe( false );
	} );
} );
