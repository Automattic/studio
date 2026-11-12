import { __ } from '@wordpress/i18n';
import { InvalidCredentialError, ProviderNotReadyError } from '../errors';
import type { OpenaiConfig } from './config';
import type { LoopbackAuthorization, Provider } from '../types';

// ChatGPT plans sign in through the Codex client, the way pi does.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com';
// Registered for the Codex client, so only a server on this port can receive the sign-in.
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const REFRESH_MARGIN_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const AUTH_CLAIM = 'https://api.openai.com/auth';
const PROFILE_CLAIM = 'https://api.openai.com/profile';

function requestTokens( body: Record< string, string > ): Promise< Response > {
	return fetch( `${ AUTH_URL }/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams( { client_id: CLIENT_ID, ...body } ),
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} );
}

function base64Url( bytes: Uint8Array ): string {
	return btoa( String.fromCharCode( ...bytes ) )
		.replace( /\+/g, '-' )
		.replace( /\//g, '_' )
		.replace( /=+$/, '' );
}

function readClaims( token: string ): Record< string, { [ key: string ]: unknown } | undefined > {
	try {
		const payload = token.split( '.' )[ 1 ].replace( /-/g, '+' ).replace( /_/g, '/' );
		return JSON.parse( atob( payload ) );
	} catch {
		return {};
	}
}

async function readTokens( response: Response ): Promise< OpenaiConfig > {
	const tokens = ( await response.json() ) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};
	const claims = tokens.access_token ? readClaims( tokens.access_token ) : {};
	const accountId = claims[ AUTH_CLAIM ]?.chatgpt_account_id;
	const email = claims[ PROFILE_CLAIM ]?.email;
	if ( ! tokens.access_token || ! tokens.refresh_token || typeof accountId !== 'string' ) {
		throw new InvalidCredentialError( __( 'ChatGPT sent back an incomplete sign-in.' ) );
	}
	return {
		method: 'chatgpt',
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		accessTokenExpiresAt: Date.now() + ( tokens.expires_in ?? 3600 ) * 1000,
		accountId,
		...( typeof email === 'string' ? { email } : {} ),
	};
}

export const startOpenaiConnect: NonNullable<
	Provider< OpenaiConfig >[ 'startLoopbackConnect' ]
> = async () => {
	const verifier = base64Url( crypto.getRandomValues( new Uint8Array( 32 ) ) );
	const challenge = base64Url(
		new Uint8Array( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( verifier ) ) )
	);
	const state = base64Url( crypto.getRandomValues( new Uint8Array( 16 ) ) );
	const url = new URL( `${ AUTH_URL }/oauth/authorize` );
	url.search = new URLSearchParams( {
		response_type: 'code',
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		scope: 'openid profile email offline_access',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state,
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		originator: 'wordpress_studio',
	} ).toString();
	return {
		url: url.toString(),
		redirectUri: REDIRECT_URI,
		state,
		verifier,
	} satisfies LoopbackAuthorization;
};

// Takes the redirect's code with the verifier `startConnect` made.
export const connectOpenai: Provider< OpenaiConfig >[ 'connect' ] = async ( input ) => {
	if ( ! input.code || ! input.verifier ) {
		throw new InvalidCredentialError( __( 'Start signing in with ChatGPT again.' ) );
	}
	const response = await requestTokens( {
		grant_type: 'authorization_code',
		code: input.code,
		code_verifier: input.verifier,
		redirect_uri: REDIRECT_URI,
	} );
	if ( ! response.ok ) {
		throw new InvalidCredentialError(
			__( 'ChatGPT sign-in could not be completed. Try again.' ),
			'unverified'
		);
	}
	return readTokens( response );
};

// Renews the access token shortly before it expires. A refresh token OpenAI
// no longer accepts means the user has to sign in again.
export const refreshOpenai: NonNullable< Provider< OpenaiConfig >[ 'refresh' ] > = async (
	config
) => {
	if ( config.accessTokenExpiresAt - Date.now() > REFRESH_MARGIN_MS ) {
		return undefined;
	}
	const response = await requestTokens( {
		grant_type: 'refresh_token',
		refresh_token: config.refreshToken,
	} );
	if ( response.status === 400 || response.status === 401 ) {
		throw new ProviderNotReadyError(
			'ChatGPT sign-in expired. Switch to ChatGPT with /provider to sign in again.'
		);
	}
	if ( ! response.ok ) {
		throw new Error( `ChatGPT sign-in could not be renewed (${ response.status }).` );
	}
	return readTokens( response );
};
