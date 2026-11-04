import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PERSONA, PERSONAS_DIR, readJson } from './paths.ts';
import { Persona, describeIssues } from './schema.ts';

export interface AuthToken {
	accessToken: string;
	expiresIn: number;
	expirationTime: number;
	id: number;
	email: string;
	displayName: string;
	[ key: string ]: unknown;
}

/**
 * Who signed-in scripts are signed in as: a made-up demo person, or a real
 * WordPress.com account from `STUDIO_CAPTURE_AUTH_TOKEN`.
 */
export interface SignedInAs {
	token: AuthToken;
	// A demo person's avatar, answered for Studio's Gravatar requests (`null`:
	// none, so Studio draws its own). Unset for a real account, whose own shows.
	avatar?: Buffer | null;
	// The email to hide on screen: a real account's. A demo person's is made up.
	hideEmail: string | null;
}

// `STUDIO_DOCS_AUTH_TOKEN` is the name the docs scripts used first.
const TOKEN_VARS = [ 'STUDIO_CAPTURE_AUTH_TOKEN', 'STUDIO_DOCS_AUTH_TOKEN' ];

// Not a WordPress.com token: requests made with it are refused, and every
// answer a signed-in shot needs comes from the scene instead.
const DEMO_ACCESS_TOKEN = 'studio-capture-demo';

/** A persona by bundled name (`personas/<name>.json`) or by path. */
async function loadPersona( ref: string ): Promise< Persona & { file: string } > {
	const bundled = path.join( PERSONAS_DIR, `${ ref }.json` );
	const file = ! ref.includes( '/' ) && existsSync( bundled ) ? bundled : path.resolve( ref );
	if ( ! existsSync( file ) ) {
		throw new Error( `No persona "${ ref }": use a file, or one of personas/ by name.` );
	}
	const data = await readJson( file );
	const parsed = Persona.safeParse( data );
	if ( ! parsed.success ) {
		throw new Error(
			`${ file } is not a valid persona:\n  ${ describeIssues( parsed.error, data ).join(
				'\n  '
			) }`
		);
	}
	return { ...parsed.data, file };
}

/**
 * The login for signed-in scripts. By default a made-up demo person (`persona`,
 * from `personas/`): Studio trusts its stored login and checks it with
 * WordPress.com only when someone logs in, so a demo login shows as signed in,
 * and the scene answers for the account. No real account is involved.
 * `STUDIO_CAPTURE_AUTH_TOKEN` (the `authToken` object of a Studio `shared.json`,
 * as JSON) signs in as a real account instead; only the throwaway profile gets
 * a copy, and no step logs out, which would revoke it.
 */
export async function signIn(
	persona = DEFAULT_PERSONA,
	env: NodeJS.ProcessEnv = process.env
): Promise< SignedInAs > {
	const fromEnv = TOKEN_VARS.map( ( name ) => env[ name ] ).find( Boolean );
	if ( fromEnv ) {
		const token = JSON.parse( fromEnv ) as Partial< AuthToken >;
		if ( ! token.accessToken ) {
			throw new Error( 'STUDIO_CAPTURE_AUTH_TOKEN has no accessToken.' );
		}
		if ( Date.now() >= ( token.expirationTime ?? 0 ) ) {
			throw new Error( 'The WordPress.com login in STUDIO_CAPTURE_AUTH_TOKEN has expired.' );
		}
		return {
			token: { expiresIn: 1209600, displayName: '', ...token } as AuthToken,
			hideEmail: token.email ?? null,
		};
	}
	const demo = await loadPersona( persona );
	return {
		token: {
			accessToken: DEMO_ACCESS_TOKEN,
			expiresIn: 1209600,
			// Far off, so the login never lapses mid-run (Studio checks it).
			expirationTime: Date.UTC( 2100, 0, 1 ),
			id: demo.id,
			email: demo.email,
			displayName: demo.name,
		},
		avatar: demo.avatar
			? await readFile( path.resolve( path.dirname( demo.file ), demo.avatar ) )
			: null,
		hideEmail: null,
	};
}
