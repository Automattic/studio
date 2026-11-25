import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectError } from '../../errors';
import { getProvider } from '../../registry';
import { localLlmAccount } from '../account';

const json = ( status: number, body: unknown ) =>
	new Response( JSON.stringify( body ), { status } );

// Ollama lists its most recent pull first: here an embedding-only model, then one that can't call
// tools.
const ollamaModels = {
	object: 'list',
	data: [ { id: 'all-minilm:latest' }, { id: 'gemma3:270m' }, { id: 'qwen3:0.6b' } ],
};
const ollamaCapabilities: Record< string, string[] > = {
	'all-minilm:latest': [ 'embedding' ],
	'gemma3:270m': [ 'completion' ],
	'qwen3:0.6b': [ 'completion', 'tools', 'thinking' ],
};

describe( 'local-llm account', () => {
	const fetchMock = vi.fn();

	// An Ollama server at 127.0.0.1:11434, which takes no key.
	const serveOllama = ( models: unknown = ollamaModels ) =>
		fetchMock.mockImplementation( async ( url: string, init?: RequestInit ) => {
			if ( url === 'http://127.0.0.1:11434/v1/models' ) {
				return json( 200, models );
			}
			if ( url === 'http://127.0.0.1:11434/api/show' ) {
				const { model } = JSON.parse( String( init?.body ) );
				return json( 200, { capabilities: ollamaCapabilities[ model ] } );
			}
			throw new TypeError( 'fetch failed' );
		} );

	const connect = ( address: string, apiKey = '' ) =>
		localLlmAccount.connect( 'server', { address, apiKey } );

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it.each( [
		'http://127.0.0.1:11434',
		'http://127.0.0.1:11434/v1',
		'http://127.0.0.1:11434/v1/',
		'127.0.0.1:11434',
	] )( 'connects to the server at %s with no key', async ( address ) => {
		serveOllama();

		await expect( connect( address ) ).resolves.toEqual( {
			method: 'server',
			baseUrl: 'http://127.0.0.1:11434/v1',
			// The one that calls tools first, without the embedding model.
			models: [
				{ name: 'qwen3:0.6b', images: false },
				{ name: 'gemma3:270m', images: false },
			],
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://127.0.0.1:11434/v1/models',
			expect.objectContaining( { headers: {} } )
		);
	} );

	it( 'connects with the key left out of the form', async () => {
		serveOllama();

		await expect(
			localLlmAccount.connect( 'server', { address: '127.0.0.1:11434' } )
		).resolves.toMatchObject( { baseUrl: 'http://127.0.0.1:11434/v1' } );
	} );

	it( 'keeps the server’s order when it doesn’t say what its models do', async () => {
		fetchMock.mockImplementation( async ( url: string ) =>
			url.endsWith( '/v1/models' )
				? json( 200, { data: [ { id: 'Qwen/Qwen3-4B' }, { id: 'Qwen/Qwen3-8B' } ] } )
				: json( 404, {} )
		);

		await expect( connect( 'http://localhost:8000' ) ).resolves.toMatchObject( {
			models: [ { name: 'Qwen/Qwen3-4B' }, { name: 'Qwen/Qwen3-8B' } ],
		} );
	} );

	it( 'sends the key to a server that asks for one, and never shows it back', async () => {
		fetchMock.mockImplementation( async ( url: string, init?: RequestInit ) =>
			( init?.headers as Record< string, string > | undefined )?.Authorization ===
			'Bearer secret-key'
				? json( 200, {
						data: [ { id: 'qwen3', architecture: { input_modalities: [ 'text' ] } } ],
				  } )
				: json( 401, { error: { message: 'Invalid API Key' } } )
		);

		const config = await connect( 'http://localhost:8080', 'secret-key' );

		expect( config ).toEqual( {
			method: 'server',
			baseUrl: 'http://localhost:8080/v1',
			apiKey: 'secret-key',
			models: [ { name: 'qwen3', images: false } ],
		} );
		expect( getProvider( 'local-llm' ).account!.describe( config ) ).toEqual( {
			method: 'server',
			summary: 'http://localhost:8080',
			models: [ { id: 'local-llm/qwen3', label: 'qwen3', supportsImages: false } ],
		} );
		for ( const key of [ '', 'wrong-key' ] ) {
			await expect( connect( 'http://localhost:8080', key ) ).rejects.toThrow(
				'The local server refused the API key. Check the key, and connect again.'
			);
		}
	} );

	it( 'names the address when no local server answers there', async () => {
		fetchMock.mockImplementation( async ( url: string ) => {
			if ( url.startsWith( 'http://localhost:3000' ) ) {
				return new Response( '<!doctype html>', { status: 200 } );
			}
			throw new TypeError( 'fetch failed' );
		} );

		for ( const address of [ '127.0.0.1:11556', 'http://localhost:3000', 'http://' ] ) {
			const connecting = connect( address );
			await expect( connecting ).rejects.toBeInstanceOf( ConnectError );
			await expect( connecting ).rejects.toThrow(
				`No local server answered at ${ address }. Check the address, and that your server is running.`
			);
		}
	} );

	it( 'fails on a server with no model to chat on yet', async () => {
		for ( const models of [
			{ object: 'list', data: null },
			{ object: 'list', data: [] },
			{ object: 'list', data: [ { id: 'all-minilm:latest' } ] },
		] ) {
			serveOllama( models );

			await expect( connect( 'http://127.0.0.1:11434' ) ).rejects.toThrow(
				'The local server has no chat model yet. Add one to your server, then connect again.'
			);
		}
	} );
} );
