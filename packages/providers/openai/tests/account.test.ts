import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderNotReadyError } from '../../errors';
import { connectOpenai, refreshOpenai, startOpenaiConnect } from '../account';
import { openaiAi } from '../ai';
import type { OpenaiConfig } from '../config';

const claims = {
	'https://api.openai.com/auth': { chatgpt_account_id: 'account-1' },
	'https://api.openai.com/profile': { email: 'me@example.com' },
};
const accessToken = `header.${ btoa( JSON.stringify( claims ) ) }.signature`;
const tokens = { access_token: accessToken, refresh_token: 'refresh-2', expires_in: 3600 };
const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const config = ( expiresIn: number ): OpenaiConfig => ( {
	method: 'chatgpt',
	accessToken: 'old-access',
	refreshToken: 'refresh-1',
	accessTokenExpiresAt: Date.now() + expiresIn,
	accountId: 'account-1',
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

	it( 'starts a PKCE sign-in that comes back to the Codex loopback address', async () => {
		const { url, redirectUri, state } = await startOpenaiConnect();

		expect( redirectUri ).toBe( 'http://localhost:1455/auth/callback' );
		expect( Object.fromEntries( new URL( url ).searchParams ) ).toMatchObject( {
			redirect_uri: redirectUri,
			state,
			code_challenge_method: 'S256',
		} );
	} );

	it( 'exchanges the redirect’s code with the verifier', async () => {
		fetchMock.mockResolvedValueOnce( json( 200, tokens ) );

		await expect( connectOpenai( { code: 'code', verifier: 'verifier' } ) ).resolves.toMatchObject(
			{
				method: 'chatgpt',
				accessToken,
				refreshToken: 'refresh-2',
				accountId: 'account-1',
				email: 'me@example.com',
			}
		);
		expect( String( fetchMock.mock.calls[ 0 ][ 1 ].body ) ).toContain( 'code_verifier=verifier' );
	} );

	it( 'renews a token only when it is about to expire', async () => {
		await expect( refreshOpenai( config( 60 * 60_000 ) ) ).resolves.toBeUndefined();
		expect( fetchMock ).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce( json( 200, tokens ) );

		await expect( refreshOpenai( config( 60_000 ) ) ).resolves.toMatchObject( {
			accessToken,
			refreshToken: 'refresh-2',
		} );
		expect( String( fetchMock.mock.calls[ 0 ][ 1 ].body ) ).toContain( 'refresh_token=refresh-1' );
	} );

	it( 'asks to sign in again when OpenAI rejects the refresh token', async () => {
		fetchMock.mockResolvedValueOnce( json( 401 ) );

		await expect( refreshOpenai( config( 0 ) ) ).rejects.toBeInstanceOf( ProviderNotReadyError );
	} );

	it( 'connects models over the ChatGPT backend with the access token', async () => {
		await expect( openaiAi.connect( config( 60_000 ), 'gpt-6.1-sol', {} ) ).resolves.toMatchObject(
			{
				piProvider: 'openai-codex',
				apiKey: 'old-access',
				model: {
					id: 'gpt-6.1-sol',
					api: 'openai-codex-responses',
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
