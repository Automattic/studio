import { isRetryableAssistantError, normalizeContext } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotConnectedError } from '../../errors';
import { localLlmAi } from '../ai';
import type { ThinkingLevel } from '../../models';
import type { LocalLlmConfig } from '../config';
import type { AssistantMessage, Model } from '@earendil-works/pi-ai';

const json = ( status: number, body: unknown ) =>
	new Response( JSON.stringify( body ), { status } );

const config = ( baseUrl: string ): LocalLlmConfig => ( {
	method: 'server',
	baseUrl,
	models: [ { name: 'qwen3:0.6b', images: false } ],
} );

// What each server answers, by path, as their sources and docs describe it.
const SERVERS: Record< string, Record< string, unknown > > = {
	ollama: {
		'/v1/models': {
			data: [ { id: 'all-minilm:latest' }, { id: 'qwen3:0.6b' }, { id: 'gemma3:4b' } ],
		},
		'/api/show all-minilm:latest': { capabilities: [ 'embedding' ] },
		'/api/show qwen3:0.6b': { capabilities: [ 'completion', 'tools', 'thinking' ] },
		'/api/show gemma3:4b': { capabilities: [ 'completion', 'vision' ] },
	},
	'llama-server': {
		'/v1/models': {
			data: [
				{
					id: 'gemma-3-4b',
					architecture: { input_modalities: [ 'text', 'image' ] },
					meta: { n_ctx: 16384 },
				},
			],
		},
	},
	vllm: {
		'/v1/models': { data: [ { id: 'Qwen/Qwen3-8B', max_model_len: 40960 } ] },
	},
	'lm-studio': {
		'/v1/models': {
			data: [
				{ id: 'google/gemma-3-4b' },
				{ id: 'text-embedding-nomic-embed-text-v1.5' },
				{ id: 'qwen/qwen3-8b' },
			],
		},
	},
	unknown: {
		'/v1/models': { data: [ { id: 'some-model' } ] },
	},
};

// LM Studio's models, which `/api/v1/models` lists with an instance once loaded. It ships the
// embedding model.
const LM_STUDIO_MODELS = [
	{
		type: 'llm',
		key: 'google/gemma-3-4b',
		capabilities: { vision: true, trained_for_tool_use: true },
	},
	{
		type: 'embedding',
		key: 'text-embedding-nomic-embed-text-v1.5',
	},
	{
		type: 'llm',
		key: 'qwen/qwen3-8b',
		capabilities: { vision: false, trained_for_tool_use: true },
	},
];

function retryable( errorMessage: string ): boolean {
	return isRetryableAssistantError( {
		role: 'assistant',
		content: [],
		stopReason: 'error',
		errorMessage,
	} as unknown as AssistantMessage );
}

describe( 'local-llm ai', () => {
	const fetchMock = vi.fn();
	// Ollama loads a model on a request that names only it, LM Studio on a chat request for it, and
	// each reports its context only then. LM Studio's load API would load it too.
	let loaded: string[];

	const serve = ( server: keyof typeof SERVERS ) =>
		fetchMock.mockImplementation( async ( url: string, init?: RequestInit ) => {
			const { pathname } = new URL( url );
			const model = init?.body ? JSON.parse( String( init.body ) ).model : undefined;
			const answers = SERVERS[ server ];
			if (
				( server === 'ollama' && pathname === '/api/generate' ) ||
				( server === 'lm-studio' &&
					[ '/v1/chat/completions', '/api/v1/models/load' ].includes( pathname ) )
			) {
				loaded.push( model );
				return json( 200, {} );
			}
			if ( server === 'ollama' && pathname === '/api/ps' ) {
				return json( 200, {
					models: loaded.map( ( name ) => ( { name, model: name, context_length: 4096 } ) ),
				} );
			}
			if ( server === 'lm-studio' && pathname === '/api/v1/models' ) {
				return json( 200, {
					models: LM_STUDIO_MODELS.map( ( entry ) => ( {
						...entry,
						loaded_instances: loaded.includes( entry.key )
							? [ { id: entry.key, config: { context_length: 8192 } } ]
							: [],
					} ) ),
				} );
			}
			const answer = answers[ model ? `${ pathname } ${ model }` : pathname ];
			return answer ? json( 200, answer ) : json( 404, { error: 'Not found' } );
		} );

	beforeEach( () => {
		loaded = [];
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'asks to connect without a config', async () => {
		await expect( localLlmAi.model( undefined, 'local-llm/qwen3', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
		await expect( localLlmAi.listModels!( undefined ) ).rejects.toBeInstanceOf( NotConnectedError );
	} );

	it.each( [
		[ 'ollama', [ 'qwen3:0.6b', false ], [ 'gemma3:4b', true ] ],
		[ 'llama-server', [ 'gemma-3-4b', true ] ],
		[ 'vllm', [ 'Qwen/Qwen3-8B', false ] ],
		[ 'lm-studio', [ 'google/gemma-3-4b', true ], [ 'qwen/qwen3-8b', false ] ],
		[ 'unknown', [ 'some-model', false ] ],
	] as const )(
		'lists the models %s offers for chat, and which read images',
		async ( server, ...models ) => {
			serve( server );

			await expect(
				localLlmAi.listModels!( config( 'http://localhost:1234/v1' ) )
			).resolves.toMatchObject(
				models.map( ( [ name, supportsImages ] ) => ( {
					id: `local-llm/${ name }`,
					label: name,
					supportsImages,
				} ) )
			);
		}
	);

	it( 'offers the picked models that call tools first, and at least one', async () => {
		const picked = [
			{ id: 'local-llm/gemma3:4b', label: 'gemma3:4b', supportsImages: true },
			{ id: 'local-llm/qwen3:0.6b', label: 'qwen3:0.6b', supportsImages: false, recommended: true },
		] as const;
		const current = config( 'http://localhost:1234/v1' );

		expect( ( await localLlmAi.selectModels!( current, [ ...picked ] ) ).models ).toEqual( [
			{ name: 'qwen3:0.6b', images: false },
			{ name: 'gemma3:4b', images: true },
		] );
		expect( () => localLlmAi.selectModels!( current, [] ) ).toThrow(
			'Pick at least one model your server offers.'
		);
	} );

	it.each( [
		[ 'ollama', 'gemma3:4b', [ 'text', 'image' ], 4096 ],
		[ 'llama-server', 'gemma-3-4b', [ 'text', 'image' ], 16384 ],
		[ 'vllm', 'Qwen/Qwen3-8B', [ 'text' ], 40960 ],
		[ 'lm-studio', 'google/gemma-3-4b', [ 'text', 'image' ], 8192 ],
	] as const )(
		'connects to a model on %s with the context the server runs it with',
		async ( server, name, input, contextWindow ) => {
			serve( server );

			const connection = await localLlmAi.model(
				config( 'http://localhost:1234/v1' ),
				`local-llm/${ name }`,
				{}
			);

			expect( connection ).toMatchObject( {
				piProvider: 'local-llm',
				requestModelId: name,
				exactContextWindow: {
					overflowMessage: `The context ${ name } runs with is too small for Studio Code. Raise its context length in your server’s settings.`,
				},
				model: {
					id: `local-llm/${ name }`,
					api: 'openai-completions',
					baseUrl: 'http://localhost:1234/v1',
					input,
					contextWindow,
					compat: {
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
						supportsStrictMode: false,
						maxTokensField: 'max_tokens',
					},
				},
			} );
		}
	);

	it.each( [
		[ 'ollama', 'qwen3:0.6b', '/api/generate' ],
		[ 'lm-studio', 'qwen/qwen3-8b', '/v1/chat/completions' ],
	] as const )(
		'has %s load a model before reading the context it runs it with',
		async ( server, name, loadPath ) => {
			serve( server );

			await localLlmAi.model( config( 'http://localhost:1234/v1' ), `local-llm/${ name }`, {} );

			expect( loaded ).toEqual( [ name ] );
			const requests = fetchMock.mock.calls.map( ( [ url, init ] ) => ( {
				path: new URL( url ).pathname,
				body: init?.body && JSON.parse( String( init.body ) ),
			} ) );
			// LM Studio keeps a model loaded through its load API until someone unloads it.
			expect( requests.map( ( { path } ) => path ) ).not.toContain( '/api/v1/models/load' );
			expect( requests.find( ( { path } ) => path === loadPath )?.body ).toMatchObject( {
				model: name,
			} );
		}
	);

	it( 'counts a model as text-only with no exact window when the server doesn’t say', async () => {
		serve( 'unknown' );

		const connection = await localLlmAi.model(
			{ ...config( 'http://localhost:1234/v1' ), apiKey: 'secret' },
			'local-llm/some-model',
			{}
		);

		expect( connection.exactContextWindow ).toBeUndefined();
		expect( connection ).toMatchObject( { apiKey: 'secret', model: { input: [ 'text' ] } } );
	} );

	it( 'sends a reasoning effort only for a level the chat picked', async () => {
		// The `reasoning_effort` a turn's request carries; the agent asks for no reasoning when off.
		const reasoningEffort = async ( thinking?: ThinkingLevel ) => {
			serve( 'vllm' );
			const { model } = await localLlmAi.model(
				config( 'http://localhost:8000/v1' ),
				'local-llm/Qwen/Qwen3-8B',
				{ thinking }
			);
			return new Promise( ( resolve ) => {
				streamSimple(
					model as Model< 'openai-completions' >,
					normalizeContext( { messages: [] } ),
					{
						apiKey: 'none',
						reasoning: thinking === 'off' ? undefined : thinking ?? 'medium',
						onPayload: ( payload ) =>
							resolve( ( payload as Record< string, unknown > ).reasoning_effort ),
					}
				);
			} );
		};

		expect( await reasoningEffort() ).toBeUndefined();
		expect( await reasoningEffort( 'off' ) ).toBe( 'none' );
		expect( await reasoningEffort( 'high' ) ).toBe( 'high' );
	} );

	describe( 'rewriteError', () => {
		const rewriteError = async () => {
			serve( 'ollama' );
			const connection = await localLlmAi.model(
				config( 'http://localhost:11434/v1' ),
				'local-llm/gemma3:270m',
				{}
			);
			return connection.rewriteError!;
		};

		it( 'says to start a server that doesn’t answer, which pi doesn’t retry', async () => {
			const rewrite = await rewriteError();

			for ( const message of [ 'Connection error.', 'Request timed out.', 'terminated' ] ) {
				const rewritten = rewrite( message );
				expect( rewritten ).toBe(
					'The local server at http://localhost:11434 isn’t answering. Start it, then send your message again.'
				);
				expect( retryable( rewritten! ) ).toBe( false );
			}
		} );

		it( 'says the server refused the key', async () => {
			expect( ( await rewriteError() )( '401: {"error":"Unauthorized"}' ) ).toBe(
				'The local server refused the API key. Check the key, and connect again.'
			);
		} );

		it( 'passes on why the server refused a request, in words', async () => {
			const rewrite = await rewriteError();

			expect(
				rewrite(
					'400: {"message":"registry.ollama.ai/library/gemma3:270m does not support tools","type":"invalid_request_error","param":null,"code":null}'
				)
			).toBe(
				'Your local server refused the request: registry.ollama.ai/library/gemma3:270m does not support tools.'
			);
			expect(
				rewrite(
					'400: {"message":"{\\"error\\":{\\"code\\":400,\\"message\\":\\"Multimodal data provided, but model does not support multimodal requests.\\",\\"type\\":\\"invalid_request_error\\"}}","type":"invalid_request_error"}'
				)
			).toBe(
				'Your local server refused the request: Multimodal data provided, but model does not support multimodal requests.'
			);
			expect(
				rewrite( '404: {"message":"model \'gemma3:270m\' not found","type":"not_found_error"}' )
			).toBe( "Your local server refused the request: model 'gemma3:270m' not found." );
		} );

		it( 'leaves context overflows, rate limits and server errors to pi', async () => {
			const rewrite = await rewriteError();

			for ( const message of [
				'400: {"error":{"message":"request (11299 tokens) exceeds the available context size (4096 tokens), try increasing it","type":"exceed_context_size_error"}}',
				'400: {"message":"This model\'s maximum context length is 4096 tokens. However, you requested 11299 tokens."}',
				'429: {"error":"Too many requests"}',
				'503: {"error":{"message":"Loading model","type":"unavailable_error"}}',
			] ) {
				expect( rewrite( message ) ).toBeUndefined();
			}
		} );
	} );
} );
