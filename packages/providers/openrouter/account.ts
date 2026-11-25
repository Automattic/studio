import { __ } from '@wordpress/i18n';
import { ConnectError } from '../errors';
import { OPENROUTER_API_URL } from './api';
import { openrouterConnectInput } from './descriptor';
import type { OpenrouterConfig } from './config';
import type { AccountServices } from '../types';

const REQUEST_TIMEOUT_MS = 15_000;

type OpenrouterAccount = AccountServices< OpenrouterConfig >;

function base64Url( bytes: Uint8Array ): string {
	return btoa( String.fromCharCode( ...bytes ) )
		.replace( /\+/g, '-' )
		.replace( /\//g, '_' )
		.replace( /=+$/, '' );
}

// OpenRouter's sign-in for apps: the user approves Studio, optionally with a
// credit limit, and the redirect's code is exchanged for an API key.
const start: NonNullable< OpenrouterAccount[ 'start' ] > = async ( _method, { redirectUri } ) => {
	if ( ! redirectUri ) {
		throw new Error( 'Signing in with OpenRouter needs an address on this computer.' );
	}
	const verifier = base64Url( crypto.getRandomValues( new Uint8Array( 32 ) ) );
	const challenge = base64Url(
		new Uint8Array( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( verifier ) ) )
	);
	const url = new URL( 'https://openrouter.ai/auth' );
	url.search = new URLSearchParams( {
		callback_url: redirectUri,
		code_challenge: challenge,
		code_challenge_method: 'S256',
	} ).toString();
	return { url: url.toString(), handoff: { verifier } };
};

async function exchangeCode( code: string, verifier: string ): Promise< string > {
	const response = await fetch( `${ OPENROUTER_API_URL }/auth/keys`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { code, code_verifier: verifier, code_challenge_method: 'S256' } ),
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} ).catch( () => undefined );
	const body = ( await response?.json().catch( () => ( {} ) ) ) as { key?: unknown } | undefined;
	if ( ! response?.ok || typeof body?.key !== 'string' || ! body.key ) {
		throw new ConnectError(
			__( 'OpenRouter sign-in could not be completed. Try again.' ),
			'unverified'
		);
	}
	return body.key;
}

// Reading the key's own details costs nothing. A key OpenRouter rejects is refused; one that can't
// be checked now (offline, an OpenRouter outage) is accepted. A key without credits still runs
// OpenRouter's free models.
async function checkApiKey( apiKey: string ): Promise< void > {
	const response = await fetch( `${ OPENROUTER_API_URL }/key`, {
		headers: { Authorization: `Bearer ${ apiKey }` },
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} ).catch( () => undefined );
	if ( response?.status === 401 || response?.status === 403 ) {
		throw new ConnectError(
			__( 'OpenRouter rejected this API key. Check the key and try again.' )
		);
	}
	if ( response?.status === 429 ) {
		throw new ConnectError(
			__( 'OpenRouter is limiting requests right now. Wait a moment and try again.' ),
			'unverified'
		);
	}
}

const connect: OpenrouterAccount[ 'connect' ] = async ( method, input ) => {
	if ( method === 'sign-in' ) {
		if ( ! input.code || ! input.verifier ) {
			throw new ConnectError( __( 'Start signing in with OpenRouter again.' ) );
		}
		const apiKey = await exchangeCode( input.code, input.verifier );
		await checkApiKey( apiKey );
		return { method: 'sign-in', apiKey };
	}
	const parsed = openrouterConnectInput().safeParse( input );
	if ( ! parsed.success ) {
		throw new ConnectError( parsed.error.issues[ 0 ].message );
	}
	await checkApiKey( parsed.data.apiKey );
	return { method: 'api-key', apiKey: parsed.data.apiKey };
};

export const openrouterAccount: OpenrouterAccount = { start, connect };
