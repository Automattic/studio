import { describe, expect, it } from 'vitest';
import { getEffectiveSessionProvider } from '@studio/agent/protocol/sessions/model';
import type { AiSettings } from '@studio/common/lib/ai-settings';

const settings = ( provider: AiSettings[ 'provider' ], connected: string[] ): AiSettings => ( {
	provider,
	accounts: {
		wpcom: connected.includes( 'wpcom' )
			? { connected: true, method: 'sign-in' }
			: { connected: false },
		anthropic: connected.includes( 'anthropic' )
			? { connected: true, method: 'api-key' }
			: { connected: false },
		openai: connected.includes( 'openai' )
			? { connected: true, method: 'chatgpt' }
			: { connected: false },
		gemini: { connected: false },
		meta: { connected: false },
		spacefast: { connected: false },
	},
} );

describe( 'getEffectiveSessionProvider', () => {
	it( 'runs on the selected provider, or the first connected one, WordPress.com first', () => {
		expect( getEffectiveSessionProvider( [], settings( 'openai', [ 'openai', 'wpcom' ] ) ) ).toBe(
			'openai'
		);
		expect(
			getEffectiveSessionProvider( [], settings( 'wpcom', [ 'openai', 'anthropic' ] ) )
		).toBe( 'anthropic' );
		expect(
			getEffectiveSessionProvider( [], settings( 'openai', [ 'wpcom', 'anthropic' ] ) )
		).toBe( 'wpcom' );
		expect( getEffectiveSessionProvider( [], settings( 'anthropic', [] ) ) ).toBe( 'wpcom' );
	} );
} );
