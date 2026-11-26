import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotConnectedError } from '../../errors';
import { findAiModel, getAiModels, getDefaultAiModel, servesAiModel } from '../../models';
import { openrouterAccount } from '../account';
import { openrouterAi, rewriteOpenrouterError } from '../ai';
import { openrouterProvider } from '../descriptor';

const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const keyInfo = () => json( 200, { data: { limit_remaining: null, is_free_tier: true } } );

const kimi = {
	slug: 'moonshotai/kimi-k9',
	label: 'MoonshotAI: Kimi K9',
	images: false,
	reasoning: true,
	contextWindow: 1_000_000,
};

describe( 'openrouter account', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'checks an API key on save and stores it trimmed', async () => {
		fetchMock.mockResolvedValueOnce( keyInfo() );

		await expect(
			openrouterAccount.connect( 'api-key', { apiKey: ' sk-or-v1-key ' } )
		).resolves.toEqual( { method: 'api-key', apiKey: 'sk-or-v1-key' } );
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://openrouter.ai/api/v1/key',
			expect.objectContaining( { headers: { Authorization: 'Bearer sk-or-v1-key' } } )
		);
	} );

	it.each( [
		[ 'a rejected key', json( 401, { error: { message: 'User not found.' } } ), 'rejected' ],
		[ 'a rate limit', json( 429 ), 'limiting requests' ],
	] )( 'refuses %s', async ( _case, response, message ) => {
		fetchMock.mockResolvedValueOnce( response );

		await expect(
			openrouterAccount.connect( 'api-key', { apiKey: 'sk-or-v1-key' } )
		).rejects.toThrow( message );
	} );

	it( 'accepts a key it can’t check', async () => {
		fetchMock.mockRejectedValueOnce( new TypeError( 'fetch failed' ) );

		await expect(
			openrouterAccount.connect( 'api-key', { apiKey: 'sk-or-v1-key' } )
		).resolves.toMatchObject( { apiKey: 'sk-or-v1-key' } );
	} );

	it( 'signs in with PKCE and stores the key OpenRouter creates', async () => {
		const { url, handoff } = await openrouterAccount.start!( 'sign-in', {
			hostId: 'host',
			redirectUri: 'http://127.0.0.1:4321/auth/callback',
		} );
		const authorize = new URL( url );
		expect( authorize.origin + authorize.pathname ).toBe( 'https://openrouter.ai/auth' );
		expect( authorize.searchParams.get( 'callback_url' ) ).toBe(
			'http://127.0.0.1:4321/auth/callback'
		);
		expect( authorize.searchParams.get( 'code_challenge_method' ) ).toBe( 'S256' );

		fetchMock
			.mockResolvedValueOnce( json( 200, { key: 'sk-or-v1-new' } ) )
			.mockResolvedValueOnce( keyInfo() );
		await expect(
			openrouterAccount.connect( 'sign-in', { ...handoff, code: 'code-1' } )
		).resolves.toEqual( { method: 'sign-in', apiKey: 'sk-or-v1-new' } );
		expect( JSON.parse( fetchMock.mock.calls[ 0 ][ 1 ].body ) ).toEqual( {
			code: 'code-1',
			code_verifier: handoff.verifier,
			code_challenge_method: 'S256',
		} );

		fetchMock.mockResolvedValueOnce( json( 403, { error: { message: 'Invalid code' } } ) );
		await expect(
			openrouterAccount.connect( 'sign-in', { ...handoff, code: 'code-2' } )
		).rejects.toThrow( 'could not be completed' );
	} );
} );

describe( 'openrouter ai', () => {
	it( 'runs a model under OpenRouter’s name for it', async () => {
		const config = { method: 'api-key' as const, apiKey: 'sk-or-v1-key', models: [ kimi ] };

		await expect(
			openrouterAi.model( config, 'openrouter/anthropic/claude-sonnet-5.5', {} )
		).resolves.toMatchObject( {
			piProvider: 'openrouter',
			apiKey: 'sk-or-v1-key',
			requestModelId: 'anthropic/claude-sonnet-5.5',
			model: { id: 'openrouter/anthropic/claude-sonnet-5.5', api: 'anthropic-messages' },
		} );
		// A model newer than pi's catalog runs with what it was picked with.
		await expect(
			openrouterAi.model( config, 'openrouter/moonshotai/kimi-k9', {} )
		).resolves.toMatchObject( {
			requestModelId: 'moonshotai/kimi-k9',
			model: { api: 'openai-completions', reasoning: true, input: [ 'text' ] },
		} );
		await expect(
			openrouterAi.model( undefined, 'openrouter/anthropic/claude-sonnet-5.5', {} )
		).rejects.toBeInstanceOf( NotConnectedError );
		await expect( openrouterAi.model( config, 'openrouter/acme/unknown', {} ) ).rejects.toThrow(
			'does not serve'
		);
	} );

	it( 'offers the models the account picked, by OpenRouter’s name', () => {
		const account = openrouterProvider.account!.describe( {
			method: 'api-key',
			apiKey: 'sk-or-v1-key',
			models: [ kimi ],
		} );
		const [ model ] = getAiModels( 'openrouter', account );

		expect( model ).toMatchObject( { id: 'openrouter/moonshotai/kimi-k9', supportsImages: false } );
		expect( model.label() ).toBe( 'MoonshotAI: Kimi K9' );
		expect( findAiModel( 'openrouter/moonshotai/kimi-k9' )?.provider ).toBe( 'openrouter' );
		expect( servesAiModel( 'openrouter', 'openrouter/moonshotai/kimi-k9' ) ).toBe( true );
		expect( servesAiModel( 'anthropic', 'openrouter/moonshotai/kimi-k9' ) ).toBe( false );
	} );

	it( 'says what an OpenRouter error status means', () => {
		expect( rewriteOpenrouterError( '402 Insufficient credits' ) ).toContain( 'credits ran out' );
		expect( rewriteOpenrouterError( '429: {"error":{}}' ) ).toContain( 'limiting requests' );
		expect( rewriteOpenrouterError( 'socket hang up' ) ).toBeUndefined();
	} );
} );

describe( 'the OpenRouter catalog', () => {
	const fetchMock = vi.fn();
	const config = { method: 'api-key' as const, apiKey: 'sk-or-v1-key' };
	const listed = {
		data: [
			{
				id: 'acme/free-model:free',
				name: 'Acme: Free Model',
				context_length: 262_144,
				architecture: { input_modalities: [ 'text' ], output_modalities: [ 'text' ] },
				pricing: { prompt: '0', completion: '0' },
				supported_parameters: [ 'tools' ],
			},
			{
				id: 'acme/no-tools',
				name: 'Acme: No Tools',
				architecture: { input_modalities: [ 'text' ], output_modalities: [ 'text' ] },
				supported_parameters: [],
			},
			{
				id: 'anthropic/claude-sonnet-5.5',
				name: 'Anthropic: Claude Sonnet 5.5',
				context_length: 1_000_000,
				architecture: { input_modalities: [ 'text', 'image' ], output_modalities: [ 'text' ] },
				pricing: { prompt: '0.000003', completion: '0.000015' },
				supported_parameters: [ 'tools', 'reasoning' ],
			},
		],
	};

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
		fetchMock.mockImplementation( async () => json( 200, listed ) );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'lists the models that call tools, Studio’s recommended ones first', async () => {
		await expect( openrouterAi.listModels!( config ) ).resolves.toEqual( [
			{
				id: 'openrouter/anthropic/claude-sonnet-5.5',
				label: 'Anthropic: Claude Sonnet 5.5',
				supportsImages: true,
				reasoning: true,
				contextWindow: 1_000_000,
				details: '$3 / $15 per million tokens · 1M context',
				recommended: true,
			},
			{
				id: 'openrouter/acme/free-model:free',
				label: 'Acme: Free Model',
				supportsImages: false,
				reasoning: false,
				contextWindow: 262_144,
				details: 'Free · 262K context',
				recommended: false,
			},
		] );
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://openrouter.ai/api/v1/models/user',
			expect.objectContaining( { headers: { Authorization: 'Bearer sk-or-v1-key' } } )
		);
	} );

	it( 'keeps what running the picked models needs', async () => {
		const [ , free ] = await openrouterAi.listModels!( config );

		expect( openrouterAi.selectModels!( config, [ free ] ) ).toEqual( {
			...config,
			models: [
				{
					slug: 'acme/free-model:free',
					label: 'Acme: Free Model',
					images: false,
					reasoning: false,
					contextWindow: 262_144,
				},
			],
		} );
		expect( () => openrouterAi.selectModels!( config, [] ) ).toThrow( 'at least one model' );
	} );

	it( 'defaults to a picked model', () => {
		const account = openrouterProvider.account!.describe( { ...config, models: [ kimi ] } );

		expect( getDefaultAiModel( 'openrouter' ) ).toBe( 'openrouter/anthropic/claude-sonnet-5.5' );
		expect( getDefaultAiModel( 'openrouter', { account: { connected: true, ...account } } ) ).toBe(
			'openrouter/moonshotai/kimi-k9'
		);
	} );
} );
