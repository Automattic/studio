import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { openaiAccount } from '../account';
import { openaiAi } from '../ai';
import { openaiConfigSchema, type OpenaiConfig } from '../config';
import { openaiProvider } from '../descriptor';

const tokens = {
	access_token: 'access-2',
	refresh_token: 'refresh-2',
	id_token: `header.${ btoa( JSON.stringify( { email: 'me@example.com' } ) ) }.signature`,
	expires_in: 3600,
	scope: 'openid email resource.invoke chatgpt.tokens.use.direct',
};
const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const config = ( expiresIn: number ): OpenaiConfig => ( {
	method: 'chatgpt',
	clientId: 'oaiapp_1',
	accessToken: 'old-access',
	refreshToken: 'refresh-1',
	accessTokenExpiresAt: Date.now() + expiresIn,
} );

describe( 'openai account', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'registers Studio as an agent on the first sign-in, then reuses its client', async () => {
		const redirectUri = 'http://127.0.0.1:5000/auth/callback';
		const params = async ( remembered?: Record< string, string > ) =>
			Object.fromEntries(
				new URL(
					(
						await openaiAccount.start!( 'chatgpt', { redirectUri, hostId: 'host', remembered } )
					).url
				).searchParams
			);

		await expect( params() ).resolves.toMatchObject( {
			client_id: 'dynamic_agent_client',
			agent_name_hint: 'WordPress Studio',
			ext_agent_host_id: 'urn:uuid:host',
			redirect_uri: redirectUri,
			resource: 'https://api.openai.com/v1',
			code_challenge_method: 'S256',
		} );
		const again = await params( { clientId: 'oaiapp_1' } );
		expect( again ).toMatchObject( { client_id: 'oaiapp_1' } );
		expect( again ).not.toHaveProperty( 'agent_name_hint' );
	} );

	it( 'exchanges the code for the client OpenAI registered, and needs plan sharing', async () => {
		const input = { code: 'code', client_id: 'oaiapp_1', verifier: 'v', redirectUri: 'r' };
		fetchMock.mockResolvedValueOnce( json( 200, tokens ) );

		await expect( openaiAccount.connect( 'chatgpt', input ) ).resolves.toMatchObject( {
			clientId: 'oaiapp_1',
			accessToken: 'access-2',
			email: 'me@example.com',
		} );
		expect( String( fetchMock.mock.calls[ 0 ][ 1 ].body ) ).toContain( 'client_id=oaiapp_1' );

		fetchMock.mockResolvedValueOnce( json( 200, { ...tokens, scope: 'openid email' } ) );
		await expect( openaiAccount.connect( 'chatgpt', input ) ).rejects.toBeInstanceOf(
			ConnectError
		);
	} );

	it( 'renews a token only when it is about to expire', async () => {
		await expect( openaiAccount.refresh!( config( 60 * 60_000 ) ) ).resolves.toBeUndefined();
		expect( fetchMock ).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce( json( 200, tokens ) );

		await expect( openaiAccount.refresh!( config( 60_000 ) ) ).resolves.toMatchObject( {
			accessToken: 'access-2',
			refreshToken: 'refresh-2',
		} );
		expect( String( fetchMock.mock.calls[ 0 ][ 1 ].body ) ).toContain( 'refresh_token=refresh-1' );
	} );

	it( 'asks to sign in again when OpenAI rejects the refresh token', async () => {
		fetchMock.mockResolvedValueOnce( json( 401 ) );

		await expect( openaiAccount.refresh!( config( 0 ) ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );

	it( 'connects models over the public API with the access token', async () => {
		await expect( openaiAi.model( config( 60_000 ), 'gpt-6.1-sol', {} ) ).resolves.toMatchObject( {
			piProvider: 'openai',
			apiKey: 'old-access',
			model: {
				id: 'gpt-6.1-sol',
				api: 'openai-responses',
				baseUrl: 'https://api.openai.com/v1',
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		} );
		await expect( openaiAi.model( undefined, 'gpt-6.1-sol', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );

	it( 'still loads a ChatGPT sign-in saved before API keys', () => {
		const saved = config( 0 );
		expect( openaiConfigSchema.parse( saved ) ).toEqual( saved );
		expect( openaiProvider.account.describe( saved ) ).toMatchObject( {
			method: 'chatgpt',
			note: 'Using ChatGPT plan',
		} );
	} );

	describe( 'with an API key', () => {
		const apiKey: OpenaiConfig = { method: 'api-key', apiKey: 'sk-proj-abcdefghijklmnop1234' };

		it( 'saves a key OpenAI accepts, or can’t check, and refuses one it rejects', async () => {
			fetchMock.mockResolvedValueOnce( json( 200 ) );
			await expect(
				openaiAccount.connect( 'api-key', { apiKey: ` ${ apiKey.apiKey } ` } )
			).resolves.toEqual( apiKey );
			expect( fetchMock.mock.calls[ 0 ][ 0 ] ).toBe( 'https://api.openai.com/v1/models' );
			expect( fetchMock.mock.calls[ 0 ][ 1 ].headers ).toEqual( {
				Authorization: `Bearer ${ apiKey.apiKey }`,
			} );

			fetchMock.mockRejectedValueOnce( new TypeError( 'offline' ) );
			await expect( openaiAccount.connect( 'api-key', { apiKey: 'sk-1' } ) ).resolves.toEqual( {
				method: 'api-key',
				apiKey: 'sk-1',
			} );

			fetchMock.mockResolvedValueOnce( json( 401 ) );
			await expect( openaiAccount.connect( 'api-key', { apiKey: 'sk-bad' } ) ).rejects.toThrow(
				'OpenAI rejected this API key'
			);
		} );

		it( 'refuses an Anthropic key without checking it', async () => {
			await expect(
				openaiAccount.connect( 'api-key', { apiKey: 'sk-ant-api03-key' } )
			).rejects.toBeInstanceOf( ConnectError );
			expect( fetchMock ).not.toHaveBeenCalled();
		} );

		it( 'never renews, and shows the key’s ends without a plan', async () => {
			await expect( openaiAccount.refresh!( apiKey ) ).resolves.toBeUndefined();
			expect( fetchMock ).not.toHaveBeenCalled();
			expect( openaiProvider.account.describe( apiKey ) ).toEqual( {
				method: 'api-key',
				summary: 'sk-proj-abcdefgh...1234',
			} );
			expect( openaiProvider.account.remember!( apiKey ) ).toBeUndefined();
		} );

		it( 'connects models with the key', async () => {
			await expect( openaiAi.model( apiKey, 'gpt-6.1-terra', {} ) ).resolves.toMatchObject( {
				piProvider: 'openai',
				apiKey: apiKey.apiKey,
				model: { id: 'gpt-6.1-terra', baseUrl: 'https://api.openai.com/v1' },
			} );
		} );

		it( 'generates images with the key, and not with a ChatGPT plan', async () => {
			const png = btoa( String.fromCharCode( 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ) );
			fetchMock.mockResolvedValueOnce( json( 200, { data: [ { b64_json: png } ] } ) );

			const [ result ] = await openaiAi.generateImages!( apiKey, [
				{ prompt: 'A lake', aspectRatio: 'portrait' },
			] );

			expect( result.ok ).toBe( true );
			const [ url, init ] = fetchMock.mock.calls[ 0 ];
			expect( url ).toBe( 'https://api.openai.com/v1/images/generations' );
			expect( init.headers.authorization ).toBe( `Bearer ${ apiKey.apiKey }` );
			expect( JSON.parse( init.body ) ).toMatchObject( {
				model: 'gpt-image-2',
				size: '1024x1536',
			} );
			expect( openaiAi.canGenerateImages!( apiKey ) ).toBe( true );
			expect( openaiAi.canGenerateImages!( config( 0 ) ) ).toBe( false );
		} );
	} );
} );
