/**
 * Figma MCP OAuth flow for the Studio CLI.
 *
 * Handles the full OAuth 2.0 authorization code flow with PKCE so the agent
 * can connect to the Figma MCP server with a pre-authenticated token.
 *
 * Flow:
 *   1. Dynamic client registration with Figma
 *   2. Open browser for user authorization
 *   3. Local HTTP server receives callback with auth code
 *   4. Exchange code for access token
 *   5. Store tokens + client info in appdata for reuse
 */

import crypto from 'crypto';
import http from 'http';
import { URL, URLSearchParams } from 'url';
import {
	getFigmaOAuthData,
	saveFigmaOAuthData,
	clearFigmaOAuthData,
	type FigmaOAuthData,
} from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';

const FIGMA_AUTH_ENDPOINT = 'https://www.figma.com/oauth/mcp';
const FIGMA_TOKEN_ENDPOINT = 'https://api.figma.com/v1/oauth/token';
const FIGMA_REGISTER_ENDPOINT = 'https://api.figma.com/v1/oauth/mcp/register';
const FIGMA_SCOPE = 'mcp:connect';
const CALLBACK_PORT = 9274;
const REDIRECT_URI = `http://localhost:${ CALLBACK_PORT }/callback`;

// --- PKCE helpers ---

function generateCodeVerifier(): string {
	return crypto.randomBytes( 32 ).toString( 'base64url' );
}

function generateCodeChallenge( verifier: string ): string {
	return crypto.createHash( 'sha256' ).update( verifier ).digest( 'base64url' );
}

function generateState(): string {
	return crypto.randomBytes( 16 ).toString( 'hex' );
}

// --- Dynamic client registration ---

interface ClientRegistration {
	client_id: string;
	client_secret?: string;
}

async function registerClient(): Promise< ClientRegistration > {
	const response = await fetch( FIGMA_REGISTER_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			client_name: 'WordPress Studio',
			redirect_uris: [ REDIRECT_URI ],
			grant_types: [ 'authorization_code', 'refresh_token' ],
			response_types: [ 'code' ],
			scope: FIGMA_SCOPE,
			token_endpoint_auth_method: 'client_secret_post',
		} ),
	} );

	if ( ! response.ok ) {
		const text = await response.text();
		throw new Error( `Figma client registration failed (${ response.status }): ${ text }` );
	}

	return ( await response.json() ) as ClientRegistration;
}

// --- Token exchange ---

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type: string;
}

async function exchangeCodeForToken(
	code: string,
	codeVerifier: string,
	clientId: string,
	clientSecret?: string
): Promise< TokenResponse > {
	const params = new URLSearchParams( {
		grant_type: 'authorization_code',
		code,
		redirect_uri: REDIRECT_URI,
		code_verifier: codeVerifier,
		client_id: clientId,
	} );
	if ( clientSecret ) {
		params.set( 'client_secret', clientSecret );
	}

	const response = await fetch( FIGMA_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params.toString(),
	} );

	if ( ! response.ok ) {
		const text = await response.text();
		throw new Error( `Figma token exchange failed (${ response.status }): ${ text }` );
	}

	return ( await response.json() ) as TokenResponse;
}

async function refreshAccessToken(
	refreshToken: string,
	clientId: string,
	clientSecret?: string
): Promise< TokenResponse > {
	const params = new URLSearchParams( {
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: clientId,
	} );
	if ( clientSecret ) {
		params.set( 'client_secret', clientSecret );
	}

	const response = await fetch( FIGMA_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: params.toString(),
	} );

	if ( ! response.ok ) {
		const text = await response.text();
		throw new Error( `Figma token refresh failed (${ response.status }): ${ text }` );
	}

	return ( await response.json() ) as TokenResponse;
}

// --- Local callback server ---

function waitForCallback( state: string ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const server = http.createServer( ( req, res ) => {
			const url = new URL( req.url ?? '', `http://localhost:${ CALLBACK_PORT }` );

			if ( url.pathname !== '/callback' ) {
				res.writeHead( 404 );
				res.end();
				return;
			}

			const code = url.searchParams.get( 'code' );
			const returnedState = url.searchParams.get( 'state' );
			const error = url.searchParams.get( 'error' );

			if ( error ) {
				res.writeHead( 200, { 'Content-Type': 'text/html' } );
				res.end(
					'<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>'
				);
				server.close();
				reject( new Error( `Figma authorization denied: ${ error }` ) );
				return;
			}

			if ( returnedState !== state ) {
				res.writeHead( 400, { 'Content-Type': 'text/html' } );
				res.end( '<html><body><h2>Invalid state</h2><p>Authorization failed.</p></body></html>' );
				server.close();
				reject( new Error( 'OAuth state mismatch' ) );
				return;
			}

			if ( ! code ) {
				res.writeHead( 400, { 'Content-Type': 'text/html' } );
				res.end( '<html><body><h2>Missing code</h2><p>Authorization failed.</p></body></html>' );
				server.close();
				reject( new Error( 'No authorization code received' ) );
				return;
			}

			res.writeHead( 200, { 'Content-Type': 'text/html' } );
			res.end(
				'<html><body><h2>Connected to Figma!</h2><p>You can close this tab and return to Studio.</p></body></html>'
			);
			server.close();
			resolve( code );
		} );

		server.listen( CALLBACK_PORT, () => {
			// Server ready
		} );

		// Timeout after 2 minutes
		setTimeout( () => {
			server.close();
			reject( new Error( 'Figma authorization timed out (2 minutes)' ) );
		}, 120_000 );
	} );
}

// --- Public API ---

/**
 * Check if we have a valid (non-expired) Figma access token.
 */
export async function hasFigmaAuth(): Promise< boolean > {
	const data = await getFigmaOAuthData();
	if ( ! data?.accessToken ) {
		return false;
	}

	// If we have an expiry and it's in the past, try refreshing
	if ( data.expiresAt && Date.now() >= data.expiresAt ) {
		if ( data.refreshToken && data.clientId ) {
			try {
				await doRefresh( data );
				return true;
			} catch {
				return false;
			}
		}
		return false;
	}

	return true;
}

/**
 * Get the current Figma access token, refreshing if needed.
 * Returns undefined if not authenticated.
 */
export async function getFigmaAccessToken(): Promise< string | undefined > {
	const data = await getFigmaOAuthData();
	if ( ! data?.accessToken ) {
		return undefined;
	}

	// Refresh if expired or about to expire (within 60 seconds)
	if ( data.expiresAt && Date.now() >= data.expiresAt - 60_000 ) {
		if ( data.refreshToken && data.clientId ) {
			try {
				const refreshed = await doRefresh( data );
				return refreshed.accessToken;
			} catch {
				return undefined;
			}
		}
		return undefined;
	}

	return data.accessToken;
}

async function doRefresh( data: FigmaOAuthData ): Promise< FigmaOAuthData > {
	const tokens = await refreshAccessToken( data.refreshToken!, data.clientId!, data.clientSecret );

	const updated: FigmaOAuthData = {
		...data,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token ?? data.refreshToken,
		expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
	};
	await saveFigmaOAuthData( updated );
	return updated;
}

/**
 * Run the full Figma OAuth flow: register client, open browser, wait for
 * callback, exchange code for token, and store everything.
 *
 * Returns the access token on success.
 */
export async function loginToFigma(): Promise< string > {
	// 1. Register as a dynamic client
	const client = await registerClient();

	// 2. Generate PKCE challenge
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge( codeVerifier );
	const state = generateState();

	// 3. Build authorization URL
	const authUrl = new URL( FIGMA_AUTH_ENDPOINT );
	authUrl.searchParams.set( 'client_id', client.client_id );
	authUrl.searchParams.set( 'redirect_uri', REDIRECT_URI );
	authUrl.searchParams.set( 'response_type', 'code' );
	authUrl.searchParams.set( 'scope', FIGMA_SCOPE );
	authUrl.searchParams.set( 'state', state );
	authUrl.searchParams.set( 'code_challenge', codeChallenge );
	authUrl.searchParams.set( 'code_challenge_method', 'S256' );

	// 4. Start local callback server + open browser
	const codePromise = waitForCallback( state );
	await openBrowser( authUrl.toString() );

	// 5. Wait for the callback
	const code = await codePromise;

	// 6. Exchange code for tokens
	const tokens = await exchangeCodeForToken(
		code,
		codeVerifier,
		client.client_id,
		client.client_secret
	);

	// 7. Store everything
	const oauthData: FigmaOAuthData = {
		clientId: client.client_id,
		clientSecret: client.client_secret,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
	};
	await saveFigmaOAuthData( oauthData );

	return tokens.access_token;
}

/**
 * Clear stored Figma OAuth data (logout).
 */
export async function logoutFromFigma(): Promise< void > {
	await clearFigmaOAuthData();
}
