import { __ } from '@wordpress/i18n';
import { ConnectError, NotConnectedError } from '../errors';
import { xaiConnectInput } from './descriptor';
import type { XaiConfig } from './config';
import type { ProviderServices } from '../types';

// The Grok CLI's device sign-in, which pi-ai uses for "xAI (Grok/X subscription)".
const AUTH_URL = 'https://auth.x.ai/oauth2';
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const API_KEY_URL = 'https://api.x.ai/v1/api-key';
const DEFAULT_INTERVAL_SECONDS = 5;
const REFRESH_MARGIN_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type XaiAccount = ProviderServices< XaiConfig >[ 'account' ];

async function post(
	path: string,
	fields: Record< string, string >
): Promise< { status: number; body: Record< string, unknown > } > {
	const response = await fetch( `${ AUTH_URL }/${ path }`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams( { client_id: CLIENT_ID, ...fields } ),
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} );
	const body = await response.json().catch( () => ( {} ) );
	return { status: response.status, body: body && typeof body === 'object' ? body : {} };
}

function readTokens(
	body: Record< string, unknown >,
	previousRefreshToken?: string
): XaiConfig | undefined {
	const { access_token, refresh_token, expires_in } = body;
	const refreshToken = typeof refresh_token === 'string' ? refresh_token : previousRefreshToken;
	if ( typeof access_token !== 'string' || ! access_token || ! refreshToken ) {
		return undefined;
	}
	return {
		method: 'grok',
		accessToken: access_token,
		refreshToken,
		accessTokenExpiresAt:
			Date.now() + ( typeof expires_in === 'number' ? expires_in : 3600 ) * 1000,
	};
}

const start: NonNullable< XaiAccount[ 'start' ] > = async () => {
	const { status, body } = await post( 'device/code', { scope: SCOPE, referrer: 'pi' } );
	const { device_code, user_code, verification_uri, verification_uri_complete } = body;
	const url = verification_uri_complete ?? verification_uri;
	if (
		status !== 200 ||
		typeof device_code !== 'string' ||
		typeof user_code !== 'string' ||
		typeof url !== 'string' ||
		! url.startsWith( 'https://' )
	) {
		throw new ConnectError( __( 'Grok sign-in could not be started. Try again.' ) );
	}
	const interval = Number( body.interval ) || DEFAULT_INTERVAL_SECONDS;
	const expiresIn = Number( body.expires_in ) || 600;
	return {
		url,
		code: user_code,
		handoff: {
			deviceCode: device_code,
			interval: String( interval ),
			expiresAt: String( Date.now() + expiresIn * 1000 ),
		},
	};
};

// Resolves once the user approves the code `start` returned.
async function waitForApproval( handoff: Record< string, string > ): Promise< XaiConfig > {
	let interval = Number( handoff.interval );
	const expiresAt = Number( handoff.expiresAt );
	if ( ! handoff.deviceCode || ! expiresAt || Number.isNaN( interval ) ) {
		throw new ConnectError( __( 'Start signing in with Grok again.' ) );
	}
	while ( Date.now() < expiresAt ) {
		await new Promise( ( resolve ) => setTimeout( resolve, interval * 1000 ) );
		const { status, body } = await post( 'token', {
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: handoff.deviceCode,
		} );
		if ( status === 200 ) {
			const config = readTokens( body );
			if ( ! config ) {
				throw new ConnectError( __( 'Grok sent back an incomplete sign-in.' ) );
			}
			return config;
		}
		if ( body.error === 'slow_down' ) {
			interval += 5;
		} else if ( body.error === 'access_denied' || body.error === 'authorization_denied' ) {
			throw new ConnectError( __( 'Grok sign-in was declined.' ), 'denied' );
		} else if ( body.error !== 'authorization_pending' ) {
			break;
		}
	}
	throw new ConnectError( __( 'The Grok sign-in expired. Try again.' ), 'denied' );
}

// A key xAI rejects or has blocked is refused; one it can't check now (offline,
// an xAI outage) is accepted.
async function checkApiKey( apiKey: string ): Promise< void > {
	let response: Response;
	try {
		response = await fetch( API_KEY_URL, {
			headers: { Authorization: `Bearer ${ apiKey }` },
			signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
		} );
	} catch {
		return;
	}
	if ( response.status === 400 || response.status === 401 ) {
		throw new ConnectError( __( 'xAI rejected this API key. Check the key and try again.' ) );
	}
	const info = response.ok
		? ( ( await response.json().catch( () => ( {} ) ) ) as Record< string, unknown > )
		: {};
	if (
		response.status === 403 ||
		info.api_key_blocked ||
		info.api_key_disabled ||
		info.team_blocked
	) {
		throw new ConnectError(
			__( 'This API key is blocked or disabled. Check it in the xAI Console.' )
		);
	}
}

const connect: XaiAccount[ 'connect' ] = async ( method, input ) => {
	if ( method === 'grok' ) {
		return waitForApproval( input );
	}
	const parsed = xaiConnectInput().safeParse( input );
	if ( ! parsed.success ) {
		throw new ConnectError( parsed.error.issues[ 0 ].message );
	}
	await checkApiKey( parsed.data.apiKey );
	return { method: 'api-key', apiKey: parsed.data.apiKey };
};

// Renews a Grok sign-in's access token shortly before it expires. A refresh
// token xAI no longer accepts means the user has to sign in again.
const refresh: NonNullable< XaiAccount[ 'refresh' ] > = async ( config ) => {
	if ( config.method !== 'grok' || config.accessTokenExpiresAt - Date.now() > REFRESH_MARGIN_MS ) {
		return undefined;
	}
	const { status, body } = await post( 'token', {
		grant_type: 'refresh_token',
		refresh_token: config.refreshToken,
	} );
	if ( status === 400 || status === 401 ) {
		throw new NotConnectedError( 'Your Grok sign-in expired. Connect xAI again.' );
	}
	const renewed = status === 200 ? readTokens( body, config.refreshToken ) : undefined;
	if ( ! renewed ) {
		throw new Error( `Grok sign-in could not be renewed (${ status }).` );
	}
	return renewed;
};

export const xaiAccount: XaiAccount = { start, connect, refresh };
