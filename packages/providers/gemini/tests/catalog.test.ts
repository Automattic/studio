import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiModels } from '../../models';
import { geminiAi } from '../ai';
import { geminiProvider } from '../descriptor';
import type { GeminiConfig } from '../config';

const config: GeminiConfig = { method: 'api-key', apiKey: 'AIza-test' };

const listed = ( ...ids: string[] ) =>
	new Response( JSON.stringify( { models: ids.map( ( id ) => ( { name: `models/${ id }` } ) ) } ) );

describe( 'gemini catalog', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'lists the chat models the key may use that pi knows, newest first, with prices', async () => {
		fetchMock.mockResolvedValueOnce(
			listed(
				'gemini-3.8-flash',
				'gemini-3.1-flash-lite',
				'gemini-4-argon',
				'gemini-3.7-flash',
				// A preview of a release that's listed, an alias, a model for one task, and one pi
				// doesn't know.
				'gemini-3.1-flash-lite-preview',
				'gemini-flash-latest',
				'gemini-2.5-computer-use-preview-10-2025',
				'gemini-5-hydrogen',
				'text-embedding-004'
			)
		);

		const models = await geminiAi.listModels!( config );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
			expect.objectContaining( { headers: { 'x-goog-api-key': 'AIza-test' } } )
		);
		expect( models ).toEqual( [
			{
				id: 'gemini-4-argon',
				label: 'Gemini 4 Argon',
				supportsImages: true,
				reasoning: true,
				details: '$2 / $10 per million tokens',
				recommended: true,
			},
			expect.objectContaining( { id: 'gemini-3.8-flash', recommended: true } ),
			expect.objectContaining( { id: 'gemini-3.7-flash', recommended: false } ),
			expect.objectContaining( { id: 'gemini-3.1-flash-lite', recommended: false } ),
		] );
	} );

	it( 'lists pi’s models when Google doesn’t list them', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '{}', { status: 500 } ) );

		const models = await geminiAi.listModels!( config );

		expect( models.filter( ( model ) => model.recommended ).map( ( { id } ) => id ) ).toEqual( [
			'gemini-4-argon',
			'gemini-3.8-flash',
		] );
		expect( models.map( ( { id } ) => id ) ).toContain( 'gemini-3.1-pro-preview' );
	} );

	it( 'offers the models the user picked, and runs only those pi knows', async () => {
		const picked = await geminiAi.selectModels!( config, [
			{ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', supportsImages: true },
		] );

		expect(
			getAiModels( 'gemini', geminiProvider.account!.describe( picked ) ).map( ( model ) =>
				model.label()
			)
		).toEqual( [ 'Gemini 3.1 Flash Lite' ] );
		await expect( geminiAi.model( picked, 'gemini-3.1-flash-lite', {} ) ).resolves.toMatchObject( {
			model: { id: 'gemini-3.1-flash-lite', contextWindow: 200_000, maxTokens: 32_000 },
		} );
		await expect( geminiAi.model( picked, 'gemini-5-hydrogen', {} ) ).rejects.toThrow(
			'Google Gemini does not serve gemini-5-hydrogen'
		);
	} );
} );
