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

export function toUrlSearchParams( body: SetAdminCredentialsRequestBody ): URLSearchParams {
	const params = new URLSearchParams();

	for ( const [ key, value ] of Object.entries( body ) ) {
		if ( value ) {
			params.set( key, value );
		}
	}

	return params;
}
