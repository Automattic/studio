import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { xaiAi } from '../ai';
import type { XaiConfig } from '../config';

const apiKey: XaiConfig = { method: 'api-key', apiKey: 'xai-test' };

const plan: XaiConfig = {
	method: 'grok',
	accessToken: 'grok-token',
	refreshToken: 'refresh',
	accessTokenExpiresAt: Date.now() + 60 * 60_000,
};

const listed = ( ...ids: string[] ) =>
	new Response( JSON.stringify( { data: ids.map( ( id ) => ( { id } ) ) } ) );

describe( 'xai catalog', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'lists the Grok models the account may use that pi knows, the newest recommended', async () => {
		fetchMock.mockResolvedValueOnce(
			listed( 'grok-4.6', 'grok-4.7', 'grok-4.3', 'grok-imagine-image', 'grok-5' )
		);

		const models = await xaiAi.listModels!( apiKey );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.x.ai/v1/models',
			expect.objectContaining( { headers: { Authorization: 'Bearer xai-test' } } )
		);
		expect( models ).toEqual( [
			{
				id: 'grok-4.7',
				label: 'Grok 4.7',
				supportsImages: true,
				reasoning: true,
				details: '$2 / $6 per million tokens',
				recommended: true,
			},
			expect.objectContaining( { id: 'grok-4.6', recommended: false } ),
			expect.objectContaining( { id: 'grok-4.3', recommended: false } ),
		] );
	} );

	it( 'offers a Grok plan its models without prices', async () => {
		fetchMock.mockResolvedValueOnce( listed( 'grok-4.7' ) );

		const models = await xaiAi.listModels!( plan );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.x.ai/v1/models',
			expect.objectContaining( { headers: { Authorization: 'Bearer grok-token' } } )
		);
		expect( models ).toEqual( [
			expect.objectContaining( { id: 'grok-4.7', details: undefined } ),
		] );
	} );

	it( 'runs a model within the reply it can write', async () => {
		await expect( xaiAi.model( apiKey, 'grok-4.3', {} ) ).resolves.toMatchObject( {
			model: { id: 'grok-4.3', maxTokens: 30_000, contextWindow: 200_000 },
		} );
	} );
} );
