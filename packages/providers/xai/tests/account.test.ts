import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { xaiAccount } from '../account';
import { xaiAi } from '../ai';
import type { XaiConfig } from '../config';

const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const grok = ( expiresIn: number ): XaiConfig => ( {
	method: 'grok',
	accessToken: 'old-access',
	refreshToken: 'refresh-1',
	accessTokenExpiresAt: Date.now() + expiresIn,
} );

const handoff = { deviceCode: 'device-1', interval: '0', expiresAt: String( Date.now() + 60_000 ) };

describe( 'xai account', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'starts a Grok sign-in with a code to approve', async () => {
		fetchMock.mockResolvedValueOnce(
			json( 200, {
				device_code: 'device-1',
				user_code: 'ABCD-EFGH',
				verification_uri: 'https://accounts.x.ai/device',
				verification_uri_complete: 'https://accounts.x.ai/device?code=ABCD-EFGH',
				expires_in: 600,
			} )
		);

		await expect( xaiAccount.start!( 'grok', { hostId: 'host' } ) ).resolves.toMatchObject( {
			url: 'https://accounts.x.ai/device?code=ABCD-EFGH',
			code: 'ABCD-EFGH',
			handoff: { deviceCode: 'device-1', interval: '5' },
		} );
	} );

	it( 'waits for the code’s approval, then stores the Grok tokens', async () => {
		fetchMock
			.mockResolvedValueOnce( json( 400, { error: 'authorization_pending' } ) )
			.mockResolvedValueOnce(
				json( 200, { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 } )
			);

		await expect( xaiAccount.connect( 'grok', handoff ) ).resolves.toMatchObject( {
			method: 'grok',
			accessToken: 'access-2',
			refreshToken: 'refresh-2',
		} );
		expect( String( fetchMock.mock.calls[ 1 ][ 1 ].body ) ).toContain( 'device_code=device-1' );

		fetchMock.mockResolvedValueOnce( json( 400, { error: 'access_denied' } ) );
		await expect( xaiAccount.connect( 'grok', handoff ) ).rejects.toThrow( 'declined' );
	} );

	it( 'checks an API key on save', async () => {
		fetchMock.mockResolvedValueOnce( json( 200, { api_key_blocked: false } ) );
		await expect( xaiAccount.connect( 'api-key', { apiKey: ' xai-key ' } ) ).resolves.toEqual( {
			method: 'api-key',
			apiKey: 'xai-key',
		} );
		expect( fetchMock.mock.calls[ 0 ][ 1 ].headers ).toEqual( { Authorization: 'Bearer xai-key' } );

		fetchMock.mockResolvedValueOnce( json( 400 ) );
		await expect( xaiAccount.connect( 'api-key', { apiKey: 'bad' } ) ).rejects.toThrow(
			'rejected this API key'
		);
		fetchMock.mockResolvedValueOnce( json( 200, { team_blocked: true } ) );
		await expect( xaiAccount.connect( 'api-key', { apiKey: 'blocked' } ) ).rejects.toThrow(
			'blocked'
		);
		fetchMock.mockRejectedValueOnce( new TypeError( 'offline' ) );
		await expect( xaiAccount.connect( 'api-key', { apiKey: 'offline' } ) ).resolves.toBeDefined();
		await expect( xaiAccount.connect( 'api-key', { apiKey: ' ' } ) ).rejects.toBeInstanceOf(
			ConnectError
		);
	} );

	it( 'renews a Grok token only when it is about to expire', async () => {
		await expect( xaiAccount.refresh!( grok( 60 * 60_000 ) ) ).resolves.toBeUndefined();
		await expect(
			xaiAccount.refresh!( { method: 'api-key', apiKey: 'xai-key' } )
		).resolves.toBeUndefined();
		expect( fetchMock ).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce( json( 200, { access_token: 'access-2', expires_in: 3600 } ) );
		await expect( xaiAccount.refresh!( grok( 60_000 ) ) ).resolves.toMatchObject( {
			accessToken: 'access-2',
			refreshToken: 'refresh-1',
		} );

		fetchMock.mockResolvedValueOnce( json( 400, { error: 'invalid_grant' } ) );
		await expect( xaiAccount.refresh!( grok( 0 ) ) ).rejects.toBeInstanceOf( NotConnectedError );
	} );

	it( 'connects Grok models with either credential, and says plan errors plainly', async () => {
		const plan = await xaiAi.model( grok( 60_000 ), 'grok-4.7', {} );
		expect( plan ).toMatchObject( {
			piProvider: 'xai',
			apiKey: 'old-access',
			model: { id: 'grok-4.7', api: 'openai-responses', baseUrl: 'https://api.x.ai/v1' },
		} );
		expect( plan.rewriteError!( 'xai API error (429): limit' ) ).toContain( 'usage limit' );
		expect( plan.rewriteError!( 'xai API error (500): oops' ) ).toBeUndefined();

		const key = await xaiAi.model( { method: 'api-key', apiKey: 'xai-key' }, 'grok-4.3', {} );
		expect( key.apiKey ).toBe( 'xai-key' );
		expect( key.rewriteError!( 'xai API error (401): bad key' ) ).toContain(
			'rejected the API key'
		);

		await expect( xaiAi.model( undefined, 'grok-4.7', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );
} );
