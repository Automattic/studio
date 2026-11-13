import { __ } from '@wordpress/i18n';
import { ConnectError, NotConnectedError } from '../errors';
import { metaConnectInput } from './descriptor';
import type { MetaConfig } from './config';
import type { ProviderServices } from '../types';

// The Muse subscription sign-in, as pi and Muse Code run it: a device sign-in on auth.meta.com
// gives an identity token, which Meta doesn't accept for inference and doesn't renew. It mints a
// Model API key billed to the subscription instead, which lasts about a day, and is minted again
// until Meta stops accepting the identity token.
const CLIENT_ID = '1031625952748946';
const AUTH_URL = 'https://auth.meta.com/oidc/device';
const MINT_URL = 'https://api.meta.ai/muse-code/key';
const MODELS_URL = 'https://api.meta.ai/v1/models';
const API_KEY_LIFETIME_MS = 24 * 60 * 60_000;
const REFRESH_MARGIN_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type MetaAccount = ProviderServices< MetaConfig >[ 'account' ];
type Json = Record< string, unknown > | null;

async function post( url: string, body: Record< string, string > ) {
	const response = await fetch( url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: new URLSearchParams( { client_id: CLIENT_ID, ...body } ),
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} );
	return { response, json: ( await response.json().catch( () => null ) ) as Json };
}

const sleep = ( ms: number ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

async function mintApiKey( identityToken: string ) {
	const response = await fetch( MINT_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${ identityToken }`,
			'Content-Type': 'application/json',
			'x-api-version': '1.0.0',
		},
		body: '{}',
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} );
	const json = ( await response.json().catch( () => null ) ) as Json;
	if ( response.status === 401 || response.status === 403 ) {
		throw new NotConnectedError( 'Your Meta sign-in expired. Connect Meta again.' );
	}
	if ( ! response.ok ) {
		throw new Error( `Meta could not renew access to its models (${ response.status }).` );
	}
	if ( typeof json?.api_key !== 'string' || ! json.api_key ) {
		const setupUrl = typeof json?.action_url === 'string' ? json.action_url : undefined;
		throw new ConnectError(
			setupUrl
				? `${ __(
						'Your Meta account can’t use Muse models yet. Finish setting it up at:'
				  ) } ${ setupUrl }`
				: __( 'Your Meta account can’t use Muse models.' ),
			'denied'
		);
	}
	return {
		method: 'subscription' as const,
		identityToken,
		apiKey: json.api_key,
		apiKeyExpiresAt: Date.now() + API_KEY_LIFETIME_MS,
	};
}

const start: NonNullable< MetaAccount[ 'start' ] > = async () => {
	const { response, json } = await post( `${ AUTH_URL }/authorization/`, {} );
	const url = json?.verification_uri_complete ?? json?.verification_uri;
	if (
		! response.ok ||
		typeof json?.device_code !== 'string' ||
		typeof json.user_code !== 'string' ||
		typeof url !== 'string' ||
		! url.startsWith( 'https://' )
	) {
		throw new Error( `Meta sign-in could not start (${ response.status }).` );
	}
	return {
		url,
		code: json.user_code,
		handoff: {
			deviceCode: json.device_code,
			interval: String( json.interval ?? 5 ),
			expiresAt: String( Date.now() + Number( json.expires_in ?? 600 ) * 1000 ),
		},
	};
};

// Waits for the user to approve the code `start` returned.
async function waitForIdentityToken( handoff: Record< string, string > ): Promise< string > {
	let interval = Number( handoff.interval );
	const expiresAt = Number( handoff.expiresAt );
	if ( ! handoff.deviceCode || ! interval || ! expiresAt ) {
		throw new ConnectError( __( 'Start signing in with Meta again.' ) );
	}
	while ( Date.now() < expiresAt ) {
		await sleep( interval * 1000 );
		const { response, json } = await post( `${ AUTH_URL }/token/`, {
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: handoff.deviceCode,
		} );
		if ( response.ok && typeof json?.access_token === 'string' && json.access_token ) {
			return json.access_token;
		}
		if ( json?.error === 'slow_down' ) {
			interval += 5;
		} else if ( json?.error === 'access_denied' ) {
			throw new ConnectError( __( 'Meta sign-in was declined.' ), 'denied' );
		} else if ( json?.error !== 'authorization_pending' ) {
			throw new ConnectError(
				__( 'Meta sign-in could not be completed. Try again.' ),
				'unverified'
			);
		}
	}
	throw new ConnectError( __( 'The Meta sign-in expired. Try again.' ), 'unverified' );
}

// Listing models costs nothing. Only a rejected key is refused; one Meta can't check (offline, an
// outage) is accepted.
async function checkApiKey( apiKey: string ): Promise< void > {
	const response = await fetch( MODELS_URL, {
		headers: { Authorization: `Bearer ${ apiKey }` },
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} ).catch( () => undefined );
	if ( response?.status === 401 ) {
		throw new ConnectError( __( 'Meta rejected this API key. Check the key and try again.' ) );
	}
}

const connect: MetaAccount[ 'connect' ] = async ( method, input ) => {
	if ( method === 'subscription' ) {
		return mintApiKey( await waitForIdentityToken( input ) );
	}
	const parsed = metaConnectInput().safeParse( input );
	if ( ! parsed.success ) {
		throw new ConnectError( parsed.error.issues[ 0 ].message );
	}
	await checkApiKey( parsed.data.apiKey );
	return { method: 'api-key', apiKey: parsed.data.apiKey };
};

// Mints a new key shortly before the subscription's one expires.
const refresh: NonNullable< MetaAccount[ 'refresh' ] > = async ( config ) => {
	if (
		config.method !== 'subscription' ||
		config.apiKeyExpiresAt - Date.now() > REFRESH_MARGIN_MS
	) {
		return undefined;
	}
	return mintApiKey( config.identityToken );
};

export const metaAccount: MetaAccount = { start, connect, refresh };
