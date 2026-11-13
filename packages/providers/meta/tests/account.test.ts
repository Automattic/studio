import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { metaAccount } from '../account';
import { metaAi } from '../ai';

describe( 'meta account', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'stores a key Meta accepts or cannot check, and refuses one it rejects', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '{}', { status: 200 } ) );
		await expect( metaAccount.connect( 'api-key', { apiKey: ' LLM_1_key ' } ) ).resolves.toEqual( {
			apiKey: 'LLM_1_key',
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.meta.ai/v1/models',
			expect.objectContaining( { headers: { Authorization: 'Bearer LLM_1_key' } } )
		);

		fetchMock.mockRejectedValueOnce( new Error( 'offline' ) );
		await expect( metaAccount.connect( 'api-key', { apiKey: 'LLM_1_key' } ) ).resolves.toEqual( {
			apiKey: 'LLM_1_key',
		} );

		fetchMock.mockResolvedValueOnce( new Response( '{}', { status: 401 } ) );
		await expect( metaAccount.connect( 'api-key', { apiKey: 'bad' } ) ).rejects.toBeInstanceOf(
			ConnectError
		);
		await expect( metaAccount.connect( 'api-key', { apiKey: ' ' } ) ).rejects.toThrow(
			'API key is required'
		);
	} );

	it( 'connects models over Meta’s Responses API with the key', async () => {
		const connection = await metaAi.model( { apiKey: 'LLM_1_key' }, 'muse-wonder-1.0', {} );
		expect( connection ).toMatchObject( {
			piProvider: 'meta',
			apiKey: 'LLM_1_key',
			model: { id: 'muse-wonder-1.0', api: 'openai-responses', baseUrl: 'https://api.meta.ai/v1' },
		} );
		expect( connection.rewriteError?.( '429 Too many requests' ) ).toContain( 'limiting requests' );
		expect( connection.rewriteError?.( '500 Internal error' ) ).toBeUndefined();
		await expect( metaAi.model( undefined, 'muse-spark-1.3', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );
} );
