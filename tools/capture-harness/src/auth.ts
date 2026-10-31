import path from 'node:path';
import { readJson } from './paths.ts';
import { REAL_STUDIO_DIR } from './profile.ts';

export interface AuthToken {
	accessToken: string;
	expirationTime: number;
	id: number;
	email: string;
	displayName: string;
	[ key: string ]: unknown;
}

// `STUDIO_DOCS_AUTH_TOKEN` is the name the docs scripts used first.
const TOKEN_VARS = [ 'STUDIO_CAPTURE_AUTH_TOKEN', 'STUDIO_DOCS_AUTH_TOKEN' ];

/**
 * The WordPress.com login for signed-in scripts: `STUDIO_CAPTURE_AUTH_TOKEN`,
 * the `authToken` object of a Studio `shared.json` as JSON, or else the login
 * of the Studio on this machine. Bots and CI (`CI` set) sign in only with the
 * variable, which should hold the demo account's token, never fall back to a
 * person's login. Only the throwaway profile gets a copy, and no step logs
 * out, which would revoke the token.
 */
export async function readAuthToken( env: NodeJS.ProcessEnv = process.env ): Promise< AuthToken > {
	const fromEnv = TOKEN_VARS.map( ( name ) => env[ name ] ).find( Boolean );
	if ( ! fromEnv && env.CI ) {
		throw new Error(
			"Signed-in scripts in CI need STUDIO_CAPTURE_AUTH_TOKEN, the demo account's login; they never use a local one."
		);
	}
	const token = fromEnv
		? ( JSON.parse( fromEnv ) as Partial< AuthToken > )
		: (
				await readJson< { authToken?: Partial< AuthToken > } >(
					path.join( REAL_STUDIO_DIR, 'shared.json' )
				).catch( () => ( {} ) as { authToken?: Partial< AuthToken > } )
		  ).authToken;
	if ( ! token?.accessToken ) {
		throw new Error(
			'Signed-in scripts need a WordPress.com login: log in to Studio, or set STUDIO_CAPTURE_AUTH_TOKEN.'
		);
	}
	if ( Date.now() >= ( token.expirationTime ?? 0 ) ) {
		throw new Error( 'The WordPress.com login has expired. Log in to Studio again.' );
	}
	return token as AuthToken;
}
