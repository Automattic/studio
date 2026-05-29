import { decodePassword } from '@studio/common/lib/passwords';
import { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

type AdminCredentialsConfig = Pick<
	ServerConfig,
	'adminUsername' | 'adminPassword' | 'adminEmail'
>;

export type SetAdminCredentialsRequestBody = {
	action: 'set_admin_password';
	username?: string;
	password?: string;
	email?: string;
};

export type SetAdminCredentialsRequest = {
	url: '/?studio-admin-api';
	method: 'POST';
	body: SetAdminCredentialsRequestBody;
};

type SendSetAdminCredentialsRequest = ( request: SetAdminCredentialsRequest ) => Promise< void >;

export function shouldSetAdminCredentials( config: AdminCredentialsConfig ): boolean {
	return Boolean( config.adminPassword || config.adminUsername || config.adminEmail );
}

export function getSetAdminCredentialsRequestBody(
	config: AdminCredentialsConfig
): SetAdminCredentialsRequestBody {
	return {
		action: 'set_admin_password',
		...( config.adminPassword && { password: decodePassword( config.adminPassword ) } ),
		...( config.adminUsername && { username: config.adminUsername } ),
		...( config.adminEmail && { email: config.adminEmail } ),
	};
}

export async function requestSetAdminCredentials(
	config: AdminCredentialsConfig,
	sendRequest: SendSetAdminCredentialsRequest
): Promise< void > {
	if ( ! shouldSetAdminCredentials( config ) ) {
		return;
	}

	// Share the admin API request shape, but let each runtime use its natural transport:
	// Playground uses its in-memory request API; native PHP posts to the local PHP server.
	await sendRequest( {
		url: '/?studio-admin-api',
		method: 'POST',
		body: getSetAdminCredentialsRequestBody( config ),
	} );
}

export function toUrlSearchParams( body: SetAdminCredentialsRequestBody ): URLSearchParams {
	const params = new URLSearchParams();

	for ( const [ key, value ] of Object.entries( body ) ) {
		if ( value ) {
			params.set( key, value );
		}
	}

	return params;
}
