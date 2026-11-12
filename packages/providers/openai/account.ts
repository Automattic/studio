import { __ } from '@wordpress/i18n';
import { InvalidCredentialError, ProviderNotReadyError } from '../errors';
import type { OpenaiConfig } from './config';
import type { LoopbackAuthorization, Provider } from '../types';

// OpenAI's sign-in for agents: each sign-in registers an OAuth client for
// Studio, and the user agrees to share their ChatGPT plan with it through the
// public API.
const AUTH_URL = 'https://auth.openai.com/api/accounts';
const RESOURCE = 'https://api.openai.com/v1';
const SHARING_SCOPE = 'chatgpt.tokens.use.direct';
const REFRESH_MARGIN_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

function requestTokens( body: Record< string, string > ): Promise< Response > {
	return fetch( `${ AUTH_URL }/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams( { ...body, resource: RESOURCE } ),
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} );
}

function base64Url( bytes: Uint8Array ): string {
	return btoa( String.fromCharCode( ...bytes ) )
		.replace( /\+/g, '-' )
		.replace( /\//g, '_' )
		.replace( /=+$/, '' );
}

function readEmail( idToken: string | undefined ): string | undefined {
	try {
		const payload = idToken!.split( '.' )[ 1 ].replace( /-/g, '+' ).replace( /_/g, '/' );
		const { email } = JSON.parse( atob( payload ) );
		return typeof email === 'string' ? email : undefined;
	} catch {
		return undefined;
	}
}

async function readTokens( response: Response, clientId: string ): Promise< OpenaiConfig > {
	const tokens = ( await response.json() ) as {
		access_token?: string;
		refresh_token?: string;
		id_token?: string;
		expires_in?: number;
		scope?: string;
	};
	if ( ! tokens.access_token || ! tokens.refresh_token ) {
		throw new InvalidCredentialError( __( 'ChatGPT sent back an incomplete sign-in.' ) );
	}
	if ( ! tokens.scope?.split( ' ' ).includes( SHARING_SCOPE ) ) {
		throw new InvalidCredentialError(
			__( 'Allow WordPress Studio to use your ChatGPT plan when signing in.' ),
			'denied'
		);
	}
	const email = readEmail( tokens.id_token );
	return {
		method: 'chatgpt',
		clientId,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		accessTokenExpiresAt: Date.now() + ( tokens.expires_in ?? 3600 ) * 1000,
		...( email ? { email } : {} ),
	};
}

export const startOpenaiConnect: NonNullable<
	Provider< OpenaiConfig >[ 'startLoopbackConnect' ]
> = async ( redirectUri, { hostId, remembered } ) => {
	const verifier = base64Url( crypto.getRandomValues( new Uint8Array( 32 ) ) );
	const challenge = base64Url(
		new Uint8Array( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( verifier ) ) )
	);
	const state = base64Url( crypto.getRandomValues( new Uint8Array( 16 ) ) );
	const url = new URL( `${ AUTH_URL }/authorize` );
	// The first sign-in registers a client for Studio; signing in again reuses it.
	url.search = new URLSearchParams( {
		...( remembered?.clientId
			? { client_id: remembered.clientId }
			: { client_id: 'dynamic_agent_client', agent_name_hint: 'WordPress Studio' } ),
		ext_agent_host_id: `urn:uuid:${ hostId }`,
		response_type: 'code',
		redirect_uri: redirectUri,
		scope: `openid profile email offline_access resource.invoke ${ SHARING_SCOPE }`,
		resource: RESOURCE,
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
	} ).toString();
	return { url: url.toString(), state, verifier } satisfies LoopbackAuthorization;
};

// A first sign-in's redirect names the client OpenAI registered for it.
export const connectOpenai: Provider< OpenaiConfig >[ 'connect' ] = async ( input ) => {
	const clientId = input.client_id ?? input.clientId;
	if ( ! input.code || ! clientId || ! input.verifier || ! input.redirectUri ) {
		throw new InvalidCredentialError( __( 'Start signing in with ChatGPT again.' ) );
	}
	const response = await requestTokens( {
		grant_type: 'authorization_code',
		client_id: clientId,
		code: input.code,
		code_verifier: input.verifier,
		redirect_uri: input.redirectUri,
	} );
	if ( ! response.ok ) {
		throw new InvalidCredentialError(
			__( 'ChatGPT sign-in could not be completed. Try again.' ),
			'unverified'
		);
	}
	return readTokens( response, clientId );
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
		client_id: config.clientId,
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
	return readTokens( response, config.clientId );
};
