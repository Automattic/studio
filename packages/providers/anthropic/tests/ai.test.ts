import { describe, expect, it } from 'vitest';
import { NotConnectedError } from '../../errors';
import { anthropicAi } from '../ai';
import { ANTHROPIC_AI_MODELS } from '../descriptor';

const connect = ( model: ( typeof ANTHROPIC_AI_MODELS )[ number ][ 'id' ] ) =>
	anthropicAi.model( { method: 'api-key', apiKey: 'sk-ant-test' }, model, {} );

describe( 'anthropic ai', () => {
	it( 'asks for an API key without a config', async () => {
		await expect( anthropicAi.model( undefined, 'claude-sonnet-5-5', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );

	it( 'hands pi a subscription token as the key, which pi sends with Bearer auth', async () => {
		const { apiKey } = await anthropicAi.model(
			{ method: 'setup-token', token: 'sk-ant-oat01-token' },
			'claude-sonnet-5-5',
			{}
		);

		expect( apiKey ).toBe( 'sk-ant-oat01-token' );
	} );

	// A model missing pi's adaptive-thinking compat gets the legacy thinking
	// shape, which current Claude models reject with a 400.
	it.each( ANTHROPIC_AI_MODELS.map( ( model ) => model.id ) )(
		'copies adaptive thinking for %s from pi’s catalog',
		async ( id ) => {
			const { piProvider, apiKey, model } = await connect( id );

			expect( piProvider ).toBe( 'anthropic' );
			expect( apiKey ).toBe( 'sk-ant-test' );
			expect( model.compat ).toMatchObject( { forceAdaptiveThinking: true } );
			// Studio's conservative limits are intentionally not the catalog's.
			expect( model ).toMatchObject( { maxTokens: 32_000, contextWindow: 200_000 } );
		}
	);
} );
