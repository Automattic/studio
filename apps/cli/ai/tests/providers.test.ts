import fs from 'fs';
import { createServer } from 'node:http';
import os from 'os';
import path from 'path';
import { confirm, input, password, select } from '@inquirer/prompts';
import {
	persistAnthropicApiKey,
	persistCustomEndpoint,
	readCustomEndpoint,
} from '@studio/common/ai/settings-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiProviderDefinition, getProviderDefaultModel } from 'cli/ai/providers';

vi.mock( '@inquirer/prompts', () => ( {
	confirm: vi.fn(),
	input: vi.fn(),
	password: vi.fn(),
	select: vi.fn(),
} ) );

describe( 'AI providers', () => {
	let configDir: string;
	const previous = process.env.DEV_CONFIG_DIR;
	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-providers-' ) );
		process.env.DEV_CONFIG_DIR = configDir;
	} );
	afterEach( () => {
		if ( previous === undefined ) {
			delete process.env.DEV_CONFIG_DIR;
		} else {
			process.env.DEV_CONFIG_DIR = previous;
		}
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'offers the models of its own families on WordPress.com, the first by default', async () => {
		const wpcom = getAiProviderDefinition( 'wpcom' );
		expect( await wpcom.getModels() ).toContain( 'balanced' );
		await expect( getProviderDefaultModel( wpcom ) ).resolves.toBe( 'fast' );
		expect( wpcom.supportsModel( 'custom:m' ) ).toBe( false );
	} );

	it( 'offers the models the connected endpoint names, and hands the turn the connection', async () => {
		const custom = getAiProviderDefinition( 'custom-endpoint' );
		expect( await custom.isReady() ).toBe( false );
		expect( await custom.getModels() ).toEqual( [] );
		await expect( custom.resolveEnv() ).rejects.toThrow( 'No custom endpoint is connected' );

		const endpoint = {
			baseUrl: 'http://127.0.0.1:1/v1',
			api: 'openai-completions' as const,
			apiKey: 'k',
			models: [ 'first', 'vendor/second' ],
			images: true,
		};
		await persistCustomEndpoint( endpoint );
		expect( await custom.isReady() ).toBe( true );
		expect( await custom.getModels() ).toEqual( [ 'custom:first', 'custom:vendor/second' ] );
		await expect( getProviderDefaultModel( custom ) ).resolves.toBe( 'custom:first' );
		expect( custom.supportsModel( 'custom:vendor/second' ) ).toBe( true );
		expect( custom.supportsModel( 'fast' ) ).toBe( false );
		const env = await custom.resolveEnv();
		expect( JSON.parse( env.STUDIO_CUSTOM_ENDPOINT! ) ).toEqual( endpoint );
		expect( env.STUDIO_WPCOM_API_KEY ).toBeUndefined();
	} );

	it( "hands another provider's turn no custom endpoint the process had", async () => {
		await persistAnthropicApiKey( 'sk-ant-test' );
		vi.stubEnv( 'STUDIO_CUSTOM_ENDPOINT', '{}' );
		try {
			const env = await getAiProviderDefinition( 'anthropic-api-key' ).resolveEnv();
			expect( env.ANTHROPIC_API_KEY ).toBe( 'sk-ant-test' );
			expect( env ).not.toHaveProperty( 'STUDIO_CUSTOM_ENDPOINT' );
		} finally {
			vi.unstubAllEnvs();
		}
	} );

	describe( 'connecting a custom endpoint', () => {
		// A local Chat Completions endpoint answering with `status`.
		const serve = async ( status: number ) => {
			const seen: Array< { authorization?: string; key?: string; model: string } > = [];
			const server = createServer( ( request, response ) => {
				let body = '';
				request.on( 'data', ( chunk ) => ( body += chunk ) );
				request.on( 'end', () => {
					seen.push( {
						authorization: request.headers.authorization,
						key: request.headers[ 'x-pool-key' ] as string | undefined,
						model: JSON.parse( body ).model,
					} );
					if ( status !== 200 ) {
						response.writeHead( status, { 'content-type': 'application/json' } );
						response.end( JSON.stringify( { error: { message: 'bad key' } } ) );
						return;
					}
					response.writeHead( 200, { 'content-type': 'text/event-stream' } );
					response.end(
						`data: ${ JSON.stringify( {
							id: '1',
							choices: [ { index: 0, delta: { content: 'ok' }, finish_reason: 'stop' } ],
						} ) }\n\ndata: [DONE]\n\n`
					);
				} );
			} );
			await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
			const { port } = server.address() as { port: number };
			return { seen, server, url: `http://127.0.0.1:${ port }/v1` };
		};
		const answer = ( url: string, keyHeader: string ) => {
			vi.mocked( select ).mockResolvedValue( 'openai-completions' );
			vi.mocked( input )
				.mockResolvedValueOnce( `${ url }/` )
				.mockResolvedValueOnce( keyHeader )
				.mockResolvedValueOnce( ' first , vendor/second ,' );
			vi.mocked( password ).mockResolvedValue( ' pool-key ' );
			vi.mocked( confirm ).mockResolvedValue( false );
		};

		it( 'saves a connection once its first model answers the way a turn asks', async () => {
			const { seen, server, url } = await serve( 200 );
			try {
				answer( url, 'x-pool-key' );
				await getAiProviderDefinition( 'custom-endpoint' ).prepare();
				expect( seen ).toEqual( [
					{ authorization: 'Bearer pool-key', key: 'pool-key', model: 'first' },
				] );
				await expect( readCustomEndpoint() ).resolves.toEqual( {
					baseUrl: url,
					api: 'openai-completions',
					apiKey: 'pool-key',
					keyHeader: 'x-pool-key',
					models: [ 'first', 'vendor/second' ],
					images: false,
				} );

				// A saved connection is kept when the user says so, without a request.
				vi.mocked( confirm ).mockResolvedValueOnce( true );
				await getAiProviderDefinition( 'custom-endpoint' ).prepare();
				expect( seen ).toHaveLength( 1 );

				// Connecting again names the API's own header, which is not saved: it takes
				// the key the way the API does.
				answer( url, 'Authorization' );
				vi.mocked( confirm ).mockResolvedValue( true );
				await getAiProviderDefinition( 'custom-endpoint' ).prepare( { force: true } );
				expect( seen[ 1 ] ).toEqual( {
					authorization: 'Bearer pool-key',
					key: undefined,
					model: 'first',
				} );
				expect( await readCustomEndpoint() ).not.toHaveProperty( 'keyHeader' );
			} finally {
				server.close();
			}
		} );

		it( 'saves no connection its endpoint refuses, and says what it answered', async () => {
			const { server, url } = await serve( 401 );
			try {
				answer( url, 'Authorization' );
				await expect( getAiProviderDefinition( 'custom-endpoint' ).prepare() ).rejects.toThrow(
					'The endpoint did not answer for first, so it was not saved: 401'
				);
				await expect( readCustomEndpoint() ).resolves.toBeUndefined();
			} finally {
				server.close();
			}
		} );
	} );
} );
