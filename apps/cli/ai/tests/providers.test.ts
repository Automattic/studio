import fs from 'fs';
import { createServer } from 'node:http';
import os from 'os';
import path from 'path';
import { confirm, input, password } from '@inquirer/prompts';
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
		type Seen = { url?: string; authorization?: string; apiKey?: string; model: string };
		// A local endpoint answering "ok" in the APIs `speaks`, and 404 on any other path.
		const serve = async ( speaks: Array< 'openai' | 'anthropic' > ) => {
			const seen: Seen[] = [];
			const server = createServer( ( request, response ) => {
				let body = '';
				request.on( 'data', ( chunk ) => ( body += chunk ) );
				request.on( 'end', () => {
					seen.push( {
						url: request.url,
						authorization: request.headers.authorization,
						apiKey: request.headers[ 'x-api-key' ] as string | undefined,
						model: JSON.parse( body ).model,
					} );
					const sse = ( event: { type?: string; [ key: string ]: unknown } ) =>
						`${ event.type ? `event: ${ event.type }\n` : '' }data: ${ JSON.stringify(
							event
						) }\n\n`;
					if ( request.url === '/v1/chat/completions' && speaks.includes( 'openai' ) ) {
						response.writeHead( 200, { 'content-type': 'text/event-stream' } );
						response.end(
							sse( {
								id: '1',
								choices: [ { index: 0, delta: { content: 'ok' }, finish_reason: 'stop' } ],
							} ) + 'data: [DONE]\n\n'
						);
						return;
					}
					if ( request.url === '/v1/messages' && speaks.includes( 'anthropic' ) ) {
						response.writeHead( 200, { 'content-type': 'text/event-stream' } );
						response.end(
							[
								{
									type: 'message_start',
									message: { id: 'm', usage: { input_tokens: 1, output_tokens: 0 } },
								},
								{
									type: 'content_block_start',
									index: 0,
									content_block: { type: 'text', text: '' },
								},
								{
									type: 'content_block_delta',
									index: 0,
									delta: { type: 'text_delta', text: 'ok' },
								},
								{ type: 'content_block_stop', index: 0 },
								{
									type: 'message_delta',
									delta: { stop_reason: 'end_turn' },
									usage: { output_tokens: 1 },
								},
								{ type: 'message_stop' },
							]
								.map( sse )
								.join( '' )
						);
						return;
					}
					response.writeHead( 404, { 'content-type': 'application/json' } );
					response.end( JSON.stringify( { error: { message: 'not found' } } ) );
				} );
			} );
			await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
			const { port } = server.address() as { port: number };
			return { seen, server, url: `http://127.0.0.1:${ port }` };
		};
		const answer = ( url: string, images = false ) => {
			vi.mocked( input )
				.mockResolvedValueOnce( `${ url }/` )
				.mockResolvedValueOnce( ' first , vendor/second ,' );
			vi.mocked( password ).mockResolvedValue( ' the-key ' );
			vi.mocked( confirm ).mockResolvedValue( images );
		};

		it( 'saves a Chat Completions endpoint once its first model answers the way a turn asks', async () => {
			const { seen, server, url } = await serve( [ 'openai' ] );
			try {
				answer( `${ url }/v1` );
				await getAiProviderDefinition( 'custom-endpoint' ).prepare();
				expect( seen ).toEqual( [
					{ url: '/v1/chat/completions', authorization: 'Bearer the-key', model: 'first' },
				] );
				await expect( readCustomEndpoint() ).resolves.toEqual( {
					baseUrl: `${ url }/v1`,
					api: 'openai-completions',
					apiKey: 'the-key',
					models: [ 'first', 'vendor/second' ],
					images: false,
				} );

				// A saved connection is kept when the user says so, without a request.
				vi.mocked( confirm ).mockResolvedValueOnce( true );
				await getAiProviderDefinition( 'custom-endpoint' ).prepare();
				expect( seen ).toHaveLength( 1 );
			} finally {
				server.close();
			}
		}, 60000 );

		it( 'saves an endpoint in Anthropic Messages when it answers only that, given its URL with or without /v1', async () => {
			const { seen, server, url } = await serve( [ 'anthropic' ] );
			try {
				for ( const entered of [ url, `${ url }/v1` ] ) {
					seen.length = 0;
					answer( entered, true );
					await getAiProviderDefinition( 'custom-endpoint' ).prepare( { force: true } );
					expect( seen.map( ( call ) => call.url ) ).toEqual( [
						entered.endsWith( '/v1' ) ? '/v1/chat/completions' : '/chat/completions',
						'/v1/messages',
					] );
					expect( seen[ 1 ] ).toMatchObject( { apiKey: 'the-key', model: 'first' } );
					await expect( readCustomEndpoint() ).resolves.toMatchObject( {
						baseUrl: url,
						api: 'anthropic-messages',
						images: true,
					} );
				}
			} finally {
				server.close();
			}
		}, 60000 );

		it( 'saves no connection the endpoint answers in no API, and says what each answered', async () => {
			const { server, url } = await serve( [] );
			try {
				answer( url );
				await expect( getAiProviderDefinition( 'custom-endpoint' ).prepare() ).rejects.toThrow(
					/^The endpoint did not answer for first, so it was not saved: 404.* \/ 404/
				);
				await expect( readCustomEndpoint() ).resolves.toBeUndefined();
			} finally {
				server.close();
			}
		}, 60000 );
	} );
} );
