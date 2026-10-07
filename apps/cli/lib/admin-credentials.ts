import { decodeAdminPassword } from '@studio/common/lib/passwords';
import { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

type AdminCredentialsConfig = Pick<
	ServerConfig,
	'adminUsername' | 'adminPassword' | 'adminEmail'
>;

const ADMIN_API_PATH = '/?studio-admin-api';

type SetAdminCredentialsRequestBody = {
	action: 'set_admin_password';
	username?: string;
	password?: string;
	email?: string;
};

export function shouldSetAdminCredentials( config: AdminCredentialsConfig ): boolean {
	return Boolean( config.adminPassword || config.adminUsername || config.adminEmail );
}

export function getSetAdminCredentialsRequestBody(
	config: AdminCredentialsConfig
): SetAdminCredentialsRequestBody {
	// The password is always sent: creating a user requires one, so omitting it fails the
	// request outright when adminUsername names a user that does not exist yet.
	return {
		action: 'set_admin_password',
		password: decodeAdminPassword( config.adminPassword ),
		...( config.adminUsername && { username: config.adminUsername } ),
		...( config.adminEmail && { email: config.adminEmail } ),
	};
}

// Applies the configured admin credentials through the running site's admin API.
export async function requestSetAdminCredentials(
	config: AdminCredentialsConfig & Pick< ServerConfig, 'port' >,
	signal?: AbortSignal
): Promise< void > {
	if ( ! shouldSetAdminCredentials( config ) ) {
		return;
	}

	const response = await fetch( `http://localhost:${ config.port }${ ADMIN_API_PATH }`, {
		method: 'POST',
		body: toUrlSearchParams( getSetAdminCredentialsRequestBody( config ) ),
		signal,
	} );
	if ( ! response.ok ) {
		throw new Error( await getAdminApiErrorMessage( response ) );
	}
}

async function getAdminApiErrorMessage( response: Response ): Promise< string > {
	const text = await response.text();
	try {
		const result = JSON.parse( text ) as { error?: string };
		return result.error ?? text;
	} catch {
		return text || response.statusText;
	}
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
