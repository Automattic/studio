import { getConnectMethod, PROVIDER_IDS, type ProviderId } from '@studio/providers';
import { describe, expect, it } from 'vitest';
import { getEffectiveSessionProvider } from '@studio/agent/protocol/sessions/model';
import type { AiSettings } from '@studio/common/lib/ai-settings';

const settings = ( provider: AiSettings[ 'provider' ], connected: ProviderId[] ): AiSettings => ( {
	provider,
	accounts: Object.fromEntries(
		PROVIDER_IDS.map( ( id ) => [
			id,
			connected.includes( id )
				? { connected: true, method: getConnectMethod( id ).id }
				: { connected: false },
		] )
	) as AiSettings[ 'accounts' ],
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
