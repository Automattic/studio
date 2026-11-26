import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiModels, servesAiModel } from '../../models';
import { anthropicAi } from '../ai';
import { anthropicProvider } from '../descriptor';
import type { AnthropicConfig } from '../config';

const apiKey: AnthropicConfig = { method: 'api-key', apiKey: 'sk-ant-test' };

const listed = ( ...ids: string[] ) =>
	new Response( JSON.stringify( { data: ids.map( ( id ) => ( { id } ) ) } ) );

describe( 'anthropic catalog', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'lists the models Anthropic offers the account that pi knows, newest of each family first', async () => {
		fetchMock.mockResolvedValueOnce(
			listed(
				'claude-haiku-4-5-20251001',
				'claude-haiku-4-5',
				'claude-opus-5-5',
				// Ones pi doesn't know, newer or older, wait for a pi upgrade or stay out.
				'claude-fable-5-2',
				'claude-opus-4-1-20250805',
				'claude-3-7-sonnet-20250219'
			)
		);

		const models = await anthropicAi.listModels!( apiKey );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.anthropic.com/v1/models?limit=1000',
			expect.objectContaining( {
				headers: expect.objectContaining( { 'x-api-key': 'sk-ant-test' } ),
			} )
		);
		expect( models ).toEqual( [
			// The alias, not its dated snapshot.
			expect.objectContaining( { id: 'claude-haiku-4-5', label: 'Haiku 4.5', recommended: true } ),
			{
				id: 'claude-opus-5-5',
				label: 'Opus 5.5',
				supportsImages: true,
				reasoning: true,
				details: '$4 / $20 per million tokens',
				recommended: true,
			},
		] );
		await expect( anthropicAi.model( apiKey, 'claude-fable-5-2', {} ) ).rejects.toThrow(
			'Anthropic does not serve claude-fable-5-2'
		);
	} );

	it( 'lists pi’s models when Anthropic doesn’t list them', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '{}', { status: 403 } ) );

		const models = await anthropicAi.listModels!( apiKey );

		expect( models.filter( ( model ) => model.recommended ).map( ( { id } ) => id ) ).toEqual(
			anthropicProvider.ai!.models.map( ( { id } ) => id ).sort()
		);
	} );

	it( 'offers a Claude plan its models without prices', async () => {
		fetchMock.mockResolvedValueOnce( listed( 'claude-fable-5-1' ) );

		const models = await anthropicAi.listModels!( {
			method: 'setup-token',
			token: 'sk-ant-oat01-t',
		} );

		expect( models ).toEqual( [
			expect.objectContaining( { id: 'claude-fable-5-1', details: undefined, recommended: true } ),
		] );
	} );

	it( 'offers the models the user picked', async () => {
		const config = await anthropicAi.selectModels!( apiKey, [
			{ id: 'claude-haiku-4-5', label: 'Haiku 4.5', supportsImages: true },
		] );
		const account = anthropicProvider.account!.describe( config );

		expect( config.models ).toEqual( [ { id: 'claude-haiku-4-5', label: 'Haiku 4.5' } ] );
		expect( getAiModels( 'anthropic', account ).map( ( model ) => model.label() ) ).toEqual( [
			'Haiku 4.5',
		] );
		expect( servesAiModel( 'anthropic', 'claude-haiku-4-5' ) ).toBe( true );
		expect( servesAiModel( 'openai', 'claude-haiku-4-5' ) ).toBe( false );
	} );
} );
