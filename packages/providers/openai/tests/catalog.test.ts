import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiModels } from '../../models';
import { openaiAi } from '../ai';
import { openaiProvider } from '../descriptor';
import type { OpenaiConfig } from '../config';

const apiKey: OpenaiConfig = { method: 'api-key', apiKey: 'sk-test' };

const plan: OpenaiConfig = {
	method: 'chatgpt',
	clientId: 'client',
	accessToken: 'plan-token',
	refreshToken: 'refresh',
	accessTokenExpiresAt: Date.now() + 60 * 60_000,
};

const listed = ( ...ids: string[] ) =>
	new Response( JSON.stringify( { data: ids.map( ( id ) => ( { id } ) ) } ) );

describe( 'openai catalog', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'lists the GPT models the key may use that reason, newest first', async () => {
		fetchMock.mockResolvedValueOnce(
			listed( 'gpt-5.4-nano', 'gpt-6.1-terra', 'gpt-4o', 'o3', 'dall-e-3', 'gpt-6-luna' )
		);

		const models = await openaiAi.listModels!( apiKey );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.openai.com/v1/models',
			expect.objectContaining( { headers: { Authorization: 'Bearer sk-test' } } )
		);
		expect( models ).toEqual( [
			{
				id: 'gpt-6.1-terra',
				label: 'GPT-6.1 Terra',
				supportsImages: true,
				reasoning: true,
				details: '$1 / $5 per million tokens',
				recommended: true,
			},
			expect.objectContaining( { id: 'gpt-6-luna', recommended: false } ),
			expect.objectContaining( { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano' } ),
		] );
	} );

	it( 'offers a ChatGPT plan pi’s models without prices when OpenAI doesn’t list them', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '{}', { status: 403 } ) );

		const models = await openaiAi.listModels!( plan );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.openai.com/v1/models',
			expect.objectContaining( { headers: { Authorization: 'Bearer plan-token' } } )
		);
		expect( models.length ).toBeGreaterThan( 20 );
		expect( models.every( ( model ) => model.details === undefined ) ).toBe( true );
		expect( models.map( ( { id } ) => id ) ).not.toContain( 'gpt-4o' );
	} );

	it( 'lists a ChatGPT plan’s own models that pi knows, saying what each is for', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify( {
					models: [
						{ slug: 'gpt-7-sol', visibility: 'list', description: 'Next generation.' },
						{ slug: 'gpt-6.2-sol', visibility: 'list', description: 'Fast, go-to model.' },
						{ slug: 'gpt-6.1-terra', visibility: 'list', description: 'Efficient model.' },
						{ slug: 'gpt-6.1-sol', visibility: 'list', description: 'Previous generation.' },
						{ slug: 'gpt-reserve', visibility: 'hide' },
					],
				} )
			)
		);

		const models = await openaiAi.listModels!( plan );

		// GPT-7 Sol is newer than pi's catalog, so it waits for a pi upgrade; GPT-6.2 Sol replaces
		// GPT-6.1 Sol as the recommended Sol.
		expect( models ).toEqual( [
			expect.objectContaining( {
				id: 'gpt-6.2-sol',
				details: 'Fast, go-to model.',
				recommended: true,
			} ),
			expect.objectContaining( {
				id: 'gpt-6.1-terra',
				details: 'Efficient model.',
				recommended: true,
			} ),
			expect.objectContaining( { id: 'gpt-6.1-sol', recommended: false } ),
		] );
		await expect( openaiAi.model( plan, 'gpt-7-sol', {} ) ).rejects.toThrow(
			'OpenAI does not serve gpt-7-sol'
		);
	} );

	it( 'offers the models the user picked, within Studio Code’s limits', async () => {
		const config = await openaiAi.selectModels!( plan, [
			{ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', supportsImages: true },
		] );
		const account = openaiProvider.account!.describe( config );

		expect( getAiModels( 'openai', account ).map( ( model ) => model.label() ) ).toEqual( [
			'GPT-5.3 Codex',
		] );
		await expect( openaiAi.model( config, 'gpt-5.3-codex', {} ) ).resolves.toMatchObject( {
			model: { id: 'gpt-5.3-codex', contextWindow: 200_000, maxTokens: 32_000 },
		} );
		await expect( openaiAi.model( config, 'gpt-4o', {} ) ).rejects.toThrow(
			'OpenAI does not serve gpt-4o'
		);
	} );
} );
