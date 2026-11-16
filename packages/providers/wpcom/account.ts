import { ConnectError } from '../errors';
import type { WpcomConfig } from './config';
import type { ProviderServices } from '../types';

// The lifetime of a token whose redirect didn't say: a pasted one.
const DEFAULT_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

// Takes the redirect's parameters, or `access_token` alone for a pasted token,
// and checks the token by reading the account it belongs to.
async function connect(
	_method: string,
	params: Record< string, string >
): Promise< WpcomConfig > {
	if ( params.error ) {
		throw new ConnectError(
			params.error_description || params.error,
			params.error === 'access_denied' ? 'denied' : 'invalid'
		);
	}
	const token = params.access_token?.trim();
	if ( ! token ) {
		throw new ConnectError( 'WordPress.com returned no token.' );
	}
	const expiresIn = Number( params.expires_in ) * 1000 || DEFAULT_TOKEN_LIFETIME_MS;

	let me: { ID?: unknown; email?: unknown; display_name?: unknown };
	try {
		const response = await fetch(
			'https://public-api.wordpress.com/rest/v1.1/me?fields=ID,email,display_name',
			{ headers: { Authorization: `Bearer ${ token }` } }
		);
		if ( ! response.ok ) {
			throw new Error( `HTTP ${ response.status }` );
		}
		me = await response.json();
	} catch ( error ) {
		throw new ConnectError(
			`Could not read the WordPress.com account: ${
				error instanceof Error ? error.message : String( error )
			}`,
			'unverified'
		);
	}
	if (
		typeof me.ID !== 'number' ||
		typeof me.email !== 'string' ||
		typeof me.display_name !== 'string'
	) {
		throw new ConnectError( 'WordPress.com returned an unexpected account.', 'unverified' );
	}
	return {
		token,
		expiresAt: Date.now() + expiresIn,
		user: { id: me.ID, email: me.email, displayName: me.display_name },
	};
}

async function disconnect( { token }: WpcomConfig ): Promise< void > {
	const response = await fetch( 'https://public-api.wordpress.com/wpcom/v2/studio-app/token', {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${ token }` },
	} );
	if ( ! response.ok ) {
		throw new Error( `Failed to revoke token: ${ response.status }` );
	}
}

export const wpcomAccount: ProviderServices< WpcomConfig >[ 'account' ] = { connect, disconnect };
