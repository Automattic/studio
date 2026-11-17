import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotConnectedError } from '../../errors';
import { ImageFilteredError, TransientImageError } from '../../wpcom/ai/images';
import { openrouterAccount } from '../account';
import { openrouterAi, rewriteOpenrouterError } from '../ai';
import { openrouterImageDialect } from '../images';

const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const keyInfo = ( data: Record< string, unknown > = {} ) =>
	json( 200, { data: { limit_remaining: null, is_free_tier: false, ...data } } );

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
		[ 'an account without credits', keyInfo( { is_free_tier: true } ), 'no credits' ],
		[ 'a key at its credit limit', keyInfo( { limit_remaining: 0 } ), 'credit limit' ],
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
	it( 'runs Studio’s model under OpenRouter’s name for it', async () => {
		const connection = await openrouterAi.model(
			{ method: 'api-key', apiKey: 'sk-or-v1-key' },
			'claude-sonnet-5-5',
			{}
		);

		expect( connection ).toMatchObject( {
			piProvider: 'openrouter',
			apiKey: 'sk-or-v1-key',
			requestModelId: 'anthropic/claude-sonnet-5.5',
			model: { id: 'claude-sonnet-5-5', api: 'anthropic-messages', provider: 'openrouter' },
		} );
		await expect( openrouterAi.model( undefined, 'claude-sonnet-5-5', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
		await expect(
			openrouterAi.model( { method: 'api-key', apiKey: 'k' }, 'muse-spark-1.3', {} )
		).rejects.toThrow( 'does not serve' );
	} );

	it( 'says what an OpenRouter error status means', () => {
		expect( rewriteOpenrouterError( '402 Insufficient credits' ) ).toContain( 'credits ran out' );
		expect( rewriteOpenrouterError( '429: {"error":{}}' ) ).toContain( 'limiting requests' );
		expect( rewriteOpenrouterError( 'socket hang up' ) ).toBeUndefined();
	} );
} );

describe( 'the OpenRouter image request', () => {
	const { body, read } = openrouterImageDialect;
	const pngBase64 = 'iVBORw0KGgoAAAANSUhEUg==';

	it( 'asks for an image at the slot’s ratio', () => {
		expect( body( { prompt: 'a shop front', aspectRatio: 'portrait' }, 'model' ) ).toMatchObject( {
			modalities: [ 'image', 'text' ],
			image_config: { aspect_ratio: '9:16' },
		} );
	} );

	it( 'reads the image from the data URL', () => {
		const raw = JSON.stringify( {
			choices: [
				{ message: { images: [ { image_url: { url: `data:image/png;base64,${ pngBase64 }` } } ] } },
			],
		} );
		expect( read( raw, 200 )[ 0 ] ).toBe( 0x89 );
		expect( () => read( '{}', 429 ) ).toThrow( TransientImageError );
		expect( () =>
			read( JSON.stringify( { choices: [ { native_finish_reason: 'IMAGE_SAFETY' } ] } ), 200 )
		).toThrow( ImageFilteredError );
		expect( () => read( JSON.stringify( { error: { message: 'no credits' } } ), 402 ) ).toThrow(
			'no credits'
		);
	} );
} );
