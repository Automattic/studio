import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidCredentialError } from '../../errors';
import { connectWpcom } from '../account';
import { getAuthorizeUrl } from '../oauth';

const ME = { ID: 1, email: 'me@example.com', display_name: 'Me' };

function stubMe( response: Partial< Response > | Error ) {
	vi.stubGlobal(
		'fetch',
		response instanceof Error
			? vi.fn().mockRejectedValue( response )
			: vi.fn().mockResolvedValue( response )
	);
}

afterEach( () => vi.unstubAllGlobals() );

describe( 'getAuthorizeUrl', () => {
	it( 'asks for a token sent back to the redirect, with the state', () => {
		const url = new URL(
			getAuthorizeUrl( { redirectUri: 'wp-studio://auth', locale: 'es', state: 'abc' } )
		);

		expect( url.origin + url.pathname ).toBe( 'https://public-api.wordpress.com/oauth2/authorize' );
		expect( Object.fromEntries( url.searchParams ) ).toEqual( {
			response_type: 'token',
			client_id: '95109',
			redirect_uri: 'wp-studio://auth',
			scope: 'global',
			locale: 'es',
			state: 'abc',
		} );
	} );

	it( 'signs up first, then authorizes with the same redirect and state', () => {
		const url = new URL(
			getAuthorizeUrl( {
				redirectUri: 'http://localhost/cb',
				locale: 'en',
				state: 'abc',
				signup: true,
			} )
		);
		const authorize = new URL( url.searchParams.get( 'oauth2_redirect' )! );

		expect( url.pathname ).toBe( '/start/wpcc/oauth2-user' );
		expect( url.searchParams.get( 'oauth2_client_id' ) ).toBe( '95109' );
		expect( authorize.searchParams.get( 'redirect_uri' ) ).toBe( 'http://localhost/cb' );
		expect( authorize.searchParams.get( 'state' ) ).toBe( 'abc' );
	} );
} );

describe( 'connectWpcom', () => {
	it( 'turns the redirect into a config with the account the token belongs to', async () => {
		vi.spyOn( Date, 'now' ).mockReturnValue( 1_000 );
		stubMe( { ok: true, json: async () => ME } );

		await expect(
			connectWpcom( { access_token: 'tok', expires_in: '60', state: 'abc' } )
		).resolves.toEqual( {
			token: 'tok',
			expiresAt: 61_000,
			user: { id: 1, email: 'me@example.com', displayName: 'Me' },
		} );
		vi.restoreAllMocks();
	} );

	it.each( [
		[ { error: 'access_denied' }, 'denied' ],
		[ { error: 'server_error' }, 'invalid' ],
		[ {}, 'invalid' ],
	] )( 'refuses %j as %s', async ( params, reason ) => {
		await expect( connectWpcom( params ) ).rejects.toMatchObject( {
			constructor: InvalidCredentialError,
			reason,
		} );
	} );

	it( 'reports a token it could not check as unverified', async () => {
		stubMe( { ok: false, status: 401 } );
		await expect( connectWpcom( { access_token: 'tok' } ) ).rejects.toMatchObject( {
			reason: 'unverified',
		} );

		stubMe( new TypeError( 'Failed to fetch' ) );
		await expect( connectWpcom( { access_token: 'tok' } ) ).rejects.toMatchObject( {
			reason: 'unverified',
		} );
	} );
} );
