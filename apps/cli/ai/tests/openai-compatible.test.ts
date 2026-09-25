import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	discoverOpenAiCompatibleModels,
	resolveOpenAiCompatibleContextWindow,
} from 'cli/ai/openai-compatible';

function mockModelsResponse( data: unknown ) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue( {
			ok: true,
			json: async () => ( { data } ),
		} )
	);
}

describe( 'discoverOpenAiCompatibleModels', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'returns models with context windows from context_window (Apfel-style)', async () => {
		mockModelsResponse( [ { id: 'apple-foundationmodel', context_window: 4096 } ] );

		await expect( discoverOpenAiCompatibleModels( 'http://localhost:11435/v1' ) ).resolves.toEqual(
			[ { id: 'apple-foundationmodel', contextWindow: 4096 } ]
		);
	} );

	it( 'reads max_model_len (vLLM-style)', async () => {
		mockModelsResponse( [ { id: 'qwen3.6-27b', max_model_len: 65536 } ] );

		await expect( discoverOpenAiCompatibleModels( 'http://host:8000/v1' ) ).resolves.toEqual( [
			{ id: 'qwen3.6-27b', contextWindow: 65536 },
		] );
	} );

	it( 'omits the context window when no field is present', async () => {
		mockModelsResponse( [ { id: 'mystery-model' } ] );

		await expect( discoverOpenAiCompatibleModels( 'http://host/v1' ) ).resolves.toEqual( [
			{ id: 'mystery-model', contextWindow: undefined },
		] );
	} );

	it( 'sends a Bearer header only when an api key is provided', async () => {
		mockModelsResponse( [] );
		await discoverOpenAiCompatibleModels( 'http://host/v1', 'secret-key' );
		expect( fetch ).toHaveBeenCalledWith(
			'http://host/v1/models',
			expect.objectContaining( { headers: { authorization: 'Bearer secret-key' } } )
		);
	} );

	it( 'returns an empty array when the request fails', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'ECONNREFUSED' ) ) );
		await expect( discoverOpenAiCompatibleModels( 'http://host/v1' ) ).resolves.toEqual( [] );
	} );

	it( 'returns an empty array on a non-ok response', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, json: async () => ( {} ) } ) );
		await expect( discoverOpenAiCompatibleModels( 'http://host/v1' ) ).resolves.toEqual( [] );
	} );
} );

describe( 'resolveOpenAiCompatibleContextWindow', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'prefers an explicit override without querying the endpoint', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal( 'fetch', fetchSpy );

		await expect(
			resolveOpenAiCompatibleContextWindow( 'http://host/v1', undefined, 'model-a', 32000 )
		).resolves.toBe( 32000 );
		expect( fetchSpy ).not.toHaveBeenCalled();
	} );

	it( 'falls back to the discovered window for the selected model', async () => {
		mockModelsResponse( [
			{ id: 'model-a', max_model_len: 8192 },
			{ id: 'model-b', max_model_len: 65536 },
		] );

		await expect(
			resolveOpenAiCompatibleContextWindow( 'http://host/v1', undefined, 'model-b' )
		).resolves.toBe( 65536 );
	} );

	it( 'returns undefined when the model is not found', async () => {
		mockModelsResponse( [ { id: 'model-a', max_model_len: 8192 } ] );

		await expect(
			resolveOpenAiCompatibleContextWindow( 'http://host/v1', undefined, 'missing' )
		).resolves.toBeUndefined();
	} );
} );
