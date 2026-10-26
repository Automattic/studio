import { describe, expect, it } from 'vitest';
import { getAiProviderDefinition } from 'cli/ai/providers';

describe( 'AI providers', () => {
	it.each( [ 'wpcom', 'anthropic-api-key' ] as const )(
		'keep a models.json model on %s, which brings its own provider',
		( provider ) => {
			const definition = getAiProviderDefinition( provider );
			expect( definition.supportsModel( 'local/sees' ) ).toBe( true );
			expect( definition.supportsModel( provider === 'wpcom' ? 'claude-opus-5' : 'fast' ) ).toBe(
				false
			);
		}
	);
} );
