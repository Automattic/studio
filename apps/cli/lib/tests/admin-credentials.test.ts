import { DEFAULT_ADMIN_PASSWORD, encodePassword } from '@studio/common/lib/passwords';
import {
	getSetAdminCredentialsRequestBody,
	requestSetAdminCredentials,
	shouldSetAdminCredentials,
	toUrlSearchParams,
} from 'cli/lib/admin-credentials';

describe( 'admin credentials', () => {
	it( 'does not run when there are no admin credential overrides', () => {
		expect( shouldSetAdminCredentials( {} ) ).toBe( false );
	} );

	it( 'builds the existing admin API action body with decoded credentials', () => {
		const config = {
			adminUsername: 'site-owner',
			adminPassword: encodePassword( 'secret' ),
			adminEmail: 'owner@example.com',
		};

		expect( shouldSetAdminCredentials( config ) ).toBe( true );
		expect( getSetAdminCredentialsRequestBody( config ) ).toEqual( {
			action: 'set_admin_password',
			username: 'site-owner',
			password: 'secret',
			email: 'owner@example.com',
		} );
	} );

	it( 'falls back to the default password when the site has none stored', () => {
		// A site configured with only a username must still send a password: creating the
		// user fails without one, which previously left the site unable to start.
		expect( getSetAdminCredentialsRequestBody( { adminUsername: 'admine' } ) ).toEqual( {
			action: 'set_admin_password',
			username: 'admine',
			password: DEFAULT_ADMIN_PASSWORD,
		} );
	} );

	it( 'serializes the admin API body as form data', () => {
		const params = toUrlSearchParams( {
			action: 'set_admin_password',
			username: 'site-owner',
			password: 'secret',
		} );

		expect( params.toString() ).toBe(
			'action=set_admin_password&username=site-owner&password=secret'
		);
	} );

	describe( 'requestSetAdminCredentials', () => {
		const fetchMock = vi.fn();

		beforeEach( () => {
			fetchMock.mockReset();
			vi.stubGlobal( 'fetch', fetchMock );
		} );

		afterEach( () => {
			vi.unstubAllGlobals();
		} );

		it( 'skips the request when there are no admin credential overrides', async () => {
			await requestSetAdminCredentials( { port: 8881 } );

			expect( fetchMock ).not.toHaveBeenCalled();
		} );

		it( "posts the credentials to the running site's admin API", async () => {
			fetchMock.mockResolvedValue( new Response( '{}' ) );
			const signal = new AbortController().signal;

			await requestSetAdminCredentials(
				{ port: 8881, adminUsername: 'site-owner', adminPassword: encodePassword( 'secret' ) },
				signal
			);

			expect( fetchMock ).toHaveBeenCalledWith( 'http://localhost:8881/?studio-admin-api', {
				method: 'POST',
				body: expect.any( URLSearchParams ),
				signal,
			} );
			expect( fetchMock.mock.calls[ 0 ][ 1 ].body.toString() ).toBe(
				'action=set_admin_password&password=secret&username=site-owner'
			);
		} );

		it( 'throws the admin API error message when the request fails', async () => {
			fetchMock.mockResolvedValue(
				new Response( JSON.stringify( { error: 'Invalid username' } ), { status: 400 } )
			);

			await expect(
				requestSetAdminCredentials( { port: 8881, adminUsername: 'bad name' } )
			).rejects.toThrow( 'Invalid username' );
		} );
	} );
} );
