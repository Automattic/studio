import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidCredentialError, ProviderNotReadyError } from '../../errors';
import { connectOpenai, refreshOpenai, startOpenaiConnect } from '../account';
import { openaiAi } from '../ai';
import type { OpenaiConfig } from '../config';

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
				new URL( ( await startOpenaiConnect( redirectUri, { hostId: 'host', remembered } ) ).url )
					.searchParams
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

		await expect( connectOpenai( input ) ).resolves.toMatchObject( {
			clientId: 'oaiapp_1',
			accessToken: 'access-2',
			email: 'me@example.com',
		} );
		expect( String( fetchMock.mock.calls[ 0 ][ 1 ].body ) ).toContain( 'client_id=oaiapp_1' );

		fetchMock.mockResolvedValueOnce( json( 200, { ...tokens, scope: 'openid email' } ) );
		await expect( connectOpenai( input ) ).rejects.toBeInstanceOf( InvalidCredentialError );
	} );

	it( 'renews a token only when it is about to expire', async () => {
		await expect( refreshOpenai( config( 60 * 60_000 ) ) ).resolves.toBeUndefined();
		expect( fetchMock ).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce( json( 200, tokens ) );

		await expect( refreshOpenai( config( 60_000 ) ) ).resolves.toMatchObject( {
			accessToken: 'access-2',
			refreshToken: 'refresh-2',
		} );
		expect( String( fetchMock.mock.calls[ 0 ][ 1 ].body ) ).toContain( 'refresh_token=refresh-1' );
	} );

	it( 'asks to sign in again when OpenAI rejects the refresh token', async () => {
		fetchMock.mockResolvedValueOnce( json( 401 ) );

		await expect( refreshOpenai( config( 0 ) ) ).rejects.toBeInstanceOf( ProviderNotReadyError );
	} );

	it( 'connects models over the public API with the access token', async () => {
		await expect( openaiAi.connect( config( 60_000 ), 'gpt-6.1-sol', {} ) ).resolves.toMatchObject(
			{
				piProvider: 'openai',
				apiKey: 'old-access',
				model: {
					id: 'gpt-6.1-sol',
					api: 'openai-responses',
					baseUrl: 'https://api.openai.com/v1',
					contextWindow: 200_000,
					maxTokens: 32_000,
				},
			}
		);
		await expect( openaiAi.connect( undefined, 'gpt-6.1-sol', {} ) ).rejects.toBeInstanceOf(
			ProviderNotReadyError
		);
	} );
} );
