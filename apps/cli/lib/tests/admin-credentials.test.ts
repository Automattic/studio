import { encodePassword } from '@studio/common/lib/passwords';
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

	it( 'skips the request when there are no admin credential overrides', async () => {
		const sendRequest = vi.fn();

		await requestSetAdminCredentials( {}, sendRequest );

		expect( sendRequest ).not.toHaveBeenCalled();
	} );

	it( 'sends the shared admin API request when credentials are configured', async () => {
		const sendRequest = vi.fn();

		await requestSetAdminCredentials(
			{ adminUsername: 'site-owner', adminPassword: encodePassword( 'secret' ) },
			sendRequest
		);

		expect( sendRequest ).toHaveBeenCalledWith( {
			url: '/?studio-admin-api',
			method: 'POST',
			body: {
				action: 'set_admin_password',
				username: 'site-owner',
				password: 'secret',
			},
		} );
	} );
} );
