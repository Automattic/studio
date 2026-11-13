import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { metaAccount } from '../account';
import { metaAi } from '../ai';
import type { MetaConfig } from '../config';

const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const handoff = () => ( {
	deviceCode: 'device-1',
	interval: '0.001',
	expiresAt: String( Date.now() + 60_000 ),
} );

const subscription = ( expiresIn: number ): MetaConfig => ( {
	method: 'subscription',
	identityToken: 'identity-1',
	apiKey: 'minted-1',
	apiKeyExpiresAt: Date.now() + expiresIn,
} );

describe( 'meta account', () => {
	const fetchMock = vi.fn();

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'starts a device sign-in with the code to approve', async () => {
		fetchMock.mockResolvedValueOnce(
			json( 200, {
				device_code: 'device-1',
				user_code: 'ABCD-1234',
				verification_uri: 'https://auth.meta.com/device',
				verification_uri_complete: 'https://auth.meta.com/device?code=ABCD-1234',
				interval: 5,
				expires_in: 600,
			} )
		);

		await expect( metaAccount.start!( 'subscription', { hostId: 'host' } ) ).resolves.toMatchObject(
			{
				url: 'https://auth.meta.com/device?code=ABCD-1234',
				code: 'ABCD-1234',
				handoff: { deviceCode: 'device-1', interval: '5' },
			}
		);
	} );

	it( 'waits for the approval, then mints a Model API key for the subscription', async () => {
		fetchMock
			.mockResolvedValueOnce( json( 400, { error: 'authorization_pending' } ) )
			.mockResolvedValueOnce( json( 200, { access_token: 'identity-1' } ) )
			.mockResolvedValueOnce( json( 200, { api_key: 'minted-1' } ) );

		await expect( metaAccount.connect( 'subscription', handoff() ) ).resolves.toMatchObject( {
			method: 'subscription',
			identityToken: 'identity-1',
			apiKey: 'minted-1',
		} );
		expect( fetchMock.mock.calls[ 2 ] ).toEqual( [
			'https://api.meta.ai/muse-code/key',
			expect.objectContaining( {
				headers: expect.objectContaining( { Authorization: 'Bearer identity-1' } ),
			} ),
		] );
	} );

	it( 'says when the sign-in is declined or the account can’t use Muse models', async () => {
		fetchMock.mockResolvedValueOnce( json( 400, { error: 'access_denied' } ) );
		await expect( metaAccount.connect( 'subscription', handoff() ) ).rejects.toThrow( 'declined' );

		fetchMock
			.mockResolvedValueOnce( json( 200, { access_token: 'identity-1' } ) )
			.mockResolvedValueOnce( json( 200, { action_url: 'https://dev.meta.ai/setup' } ) );
		await expect( metaAccount.connect( 'subscription', handoff() ) ).rejects.toThrow(
			'https://dev.meta.ai/setup'
		);
	} );

	it( 'stores a key Meta accepts or cannot check, and refuses one it rejects', async () => {
		fetchMock.mockResolvedValueOnce( json( 200, { data: [] } ) );
		await expect( metaAccount.connect( 'api-key', { apiKey: ' key-1234 ' } ) ).resolves.toEqual( {
			method: 'api-key',
			apiKey: 'key-1234',
		} );

		fetchMock.mockRejectedValueOnce( new Error( 'offline' ) );
		await expect( metaAccount.connect( 'api-key', { apiKey: 'key-1234' } ) ).resolves.toEqual( {
			method: 'api-key',
			apiKey: 'key-1234',
		} );

		fetchMock.mockResolvedValueOnce( json( 401, { error: { code: 'invalid_api_key' } } ) );
		await expect( metaAccount.connect( 'api-key', { apiKey: 'bad' } ) ).rejects.toBeInstanceOf(
			ConnectError
		);
	} );

	it( 'mints a new key only when the subscription’s is about to expire', async () => {
		await expect( metaAccount.refresh!( subscription( 60 * 60_000 ) ) ).resolves.toBeUndefined();
		await expect(
			metaAccount.refresh!( { method: 'api-key', apiKey: 'key-1234' } )
		).resolves.toBeUndefined();
		expect( fetchMock ).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce( json( 200, { api_key: 'minted-2' } ) );
		await expect( metaAccount.refresh!( subscription( 60_000 ) ) ).resolves.toMatchObject( {
			identityToken: 'identity-1',
			apiKey: 'minted-2',
		} );

		fetchMock.mockResolvedValueOnce( json( 401 ) );
		await expect( metaAccount.refresh!( subscription( 0 ) ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );

	it( 'connects models over Meta’s Responses API with either method’s key', async () => {
		await expect(
			metaAi.model( subscription( 60_000 ), 'muse-spark-1.3', {} )
		).resolves.toMatchObject( {
			piProvider: 'meta',
			apiKey: 'minted-1',
			model: { id: 'muse-spark-1.3', api: 'openai-responses', baseUrl: 'https://api.meta.ai/v1' },
		} );
		const connection = await metaAi.model(
			{ method: 'api-key', apiKey: 'key-1234' },
			'muse-wonder-1.0',
			{}
		);
		expect( connection.apiKey ).toBe( 'key-1234' );
		expect( connection.rewriteError?.( '429 Too many requests' ) ).toContain( 'usage limit' );
		expect( connection.rewriteError?.( '500 Internal error' ) ).toBeUndefined();
		await expect( metaAi.model( undefined, 'muse-spark-1.3', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );
} );
