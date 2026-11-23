import { PROVIDER_IDS } from '@studio/providers';
import { describe, expect, it } from 'vitest';
import {
	getEffectiveSessionProvider,
	resolveSessionThinking,
} from '@studio/agent/protocol/sessions/model';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { StudioSessionContextData } from '@studio/agent/protocol/sessions/entry-types';
import type { AiSettings } from '@studio/common/lib/ai-settings';

const settings = ( provider: AiSettings[ 'provider' ], connected: string[] ): AiSettings => ( {
	provider,
	accounts: Object.fromEntries(
		PROVIDER_IDS.map( ( id ) => [
			id,
			connected.includes( id ) ? { connected: true, method: 'api-key' } : { connected: false },
		] )
	) as AiSettings[ 'accounts' ],
	imageProviders: [],
	imageProvider: null,
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

describe( 'resolveSessionThinking', () => {
	const context = ( data: StudioSessionContextData ) =>
		( { type: 'custom', customType: 'studio.session_context', data } ) as SessionEntry;
	const modelChange = ( modelId: string ) => ( { type: 'model_change', modelId } ) as SessionEntry;

	it( 'keeps the level picked for the model until the session switches models', () => {
		const picked = [
			modelChange( 'claude-opus-5-5' ),
			context( { model: 'claude-opus-5-5', thinking: 'off' } ),
			context( { model: 'claude-opus-5-5' } ),
		];
		expect( resolveSessionThinking( picked, 'claude-opus-5-5' ) ).toBe( 'off' );
		expect(
			resolveSessionThinking(
				[ ...picked, context( { model: 'claude-opus-5-5', thinking: 'default' } ) ],
				'claude-opus-5-5'
			)
		).toBeUndefined();

		const switchedBack = [
			...picked,
			modelChange( 'gpt-6.1-terra' ),
			modelChange( 'claude-opus-5-5' ),
		];
		expect( resolveSessionThinking( switchedBack, 'claude-opus-5-5' ) ).toBeUndefined();
	} );
} );
