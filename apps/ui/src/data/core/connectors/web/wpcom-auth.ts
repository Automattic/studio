import { CLIENT_ID } from '@studio/common/constants';
import { revokeAuthToken } from '@studio/common/lib/oauth';
import { __ } from '@wordpress/i18n';
import { kvDelete, kvGet, kvSet } from './store';
import type { AuthUser } from '../../types';

const TOKEN_KEY = 'wpcom-token';
const API_BASE = 'https://public-api.wordpress.com';
const CALLBACK_PATH = '/auth/callback';
const RETURN_TO_KEY = 'studio-web-auth-return-to';
// WordPress.com sends the token only to a redirect URL registered on the OAuth
// app, and answers browser requests made with its tokens only from origins
// the app allows. A deployment registers `<origin>/auth/callback`, or sets its
// own app and redirect URL.
const OAUTH_CLIENT_ID = import.meta.env.VITE_WPCOM_CLIENT_ID ?? CLIENT_ID;

function getRedirectUri(): string {
	return import.meta.env.VITE_WPCOM_REDIRECT_URI ?? `${ window.location.origin }${ CALLBACK_PATH }`;
}

function getAuthorizeUrl( redirectUri: string, signup: boolean ): string {
	const authorize = new URL( `${ API_BASE }/oauth2/authorize` );
	authorize.searchParams.set( 'response_type', 'token' );
	authorize.searchParams.set( 'client_id', OAUTH_CLIENT_ID );
	authorize.searchParams.set( 'redirect_uri', redirectUri );
	authorize.searchParams.set( 'scope', 'global' );
	if ( ! signup ) {
		return authorize.toString();
	}
	const start = new URL( 'https://wordpress.com/start/wpcc/oauth2-user' );
	start.searchParams.set( 'oauth2_client_id', OAUTH_CLIENT_ID );
	start.searchParams.set( 'oauth2_redirect', authorize.toString() );
	return start.toString();
}

// A request the browser blocks surfaces as a bare "Load failed" or "Failed to
// fetch"; say what that means here.
async function wpcomFetch( url: string, init?: RequestInit ): Promise< Response > {
	try {
		return await fetch( url, init );
	} catch ( error ) {
		if ( error instanceof TypeError ) {
			throw new Error(
				__(
					'Your browser could not reach WordPress.com. WordPress.com may not allow requests from this address with Studio’s sign-in.'
				)
			);
		}
		throw error;
	}
}

export interface WpcomToken extends AuthUser {
	accessToken: string;
}

// The WordPress.com account Studio on the web is signed in to. The token stays
// in this browser profile and goes only to WordPress.com.
export class WpcomAuth {
	private readonly listeners = new Set< () => void >();
	private cached: WpcomToken | null | undefined;

	async token(): Promise< WpcomToken | null > {
		if ( this.cached === undefined ) {
			this.cached = ( await kvGet< WpcomToken >( TOKEN_KEY ) ) ?? null;
		}
		return this.cached;
	}

	async requireToken(): Promise< string > {
		const token = await this.token();
		if ( ! token ) {
			throw new Error( __( 'Sign in to WordPress.com first.' ) );
		}
		return token.accessToken;
	}

	async user(): Promise< AuthUser | null > {
		const token = await this.token();
		return token ? { id: token.id, email: token.email, displayName: token.displayName } : null;
	}

	onChange( listener: () => void ): () => void {
		this.listeners.add( listener );
		return () => this.listeners.delete( listener );
	}

	private notify() {
		this.listeners.forEach( ( listener ) => listener() );
	}

	async signIn( accessToken: string ): Promise< void > {
		const response = await wpcomFetch( `${ API_BASE }/rest/v1.1/me?fields=ID,email,display_name`, {
			headers: { Authorization: `Bearer ${ accessToken }` },
		} );
		if ( ! response.ok ) {
			throw new Error( __( 'WordPress.com did not accept the sign-in.' ) );
		}
		const me = ( await response.json() ) as { ID: number; email: string; display_name: string };
		this.cached = { accessToken, id: me.ID, email: me.email, displayName: me.display_name };
		await kvSet( TOKEN_KEY, this.cached );
		this.notify();
	}

	async signOut(): Promise< void > {
		const token = await this.token();
		this.cached = null;
		await kvDelete( TOKEN_KEY );
		this.notify();
		if ( token ) {
			await revokeAuthToken( token.accessToken ).catch( () => undefined );
		}
	}

	// Leaves for WordPress.com, which sends the browser back to /auth/callback
	// (see completeRedirectSignIn), and from there to the current page.
	async authenticate( signup: boolean ): Promise< void > {
		window.sessionStorage.setItem(
			RETURN_TO_KEY,
			`${ window.location.pathname }${ window.location.search }`
		);
		window.location.assign( getAuthorizeUrl( getRedirectUri(), signup ) );
		// The page is navigating away.
		await new Promise( () => {} );
	}

	// A WordPress.com REST request with the user's token.
	async request< T >( path: string, init: RequestInit & { apiBase?: string } = {} ): Promise< T > {
		const accessToken = await this.requireToken();
		const response = await wpcomFetch( `${ init.apiBase ?? API_BASE }${ path }`, {
			...init,
			headers: {
				Authorization: `Bearer ${ accessToken }`,
				...( init.body && ! ( init.body instanceof FormData ) && typeof init.body === 'string'
					? { 'Content-Type': 'application/json' }
					: {} ),
				...init.headers,
			},
		} );
		const text = await response.text();
		let payload: unknown = undefined;
		try {
			payload = text ? JSON.parse( text ) : undefined;
		} catch {
			payload = text;
		}
		if ( ! response.ok ) {
			const message =
				payload && typeof payload === 'object' && 'message' in payload
					? String( ( payload as { message: unknown } ).message )
					: `${ init.method ?? 'GET' } ${ path } failed (${ response.status })`;
			throw new Error( message );
		}
		return payload as T;
	}
}

// Handles WordPress.com's redirect back to /auth/callback, with the token in
// the URL fragment: signs in, then returns the address to restore. Resolves
// null on any other page.
export async function completeRedirectSignIn(): Promise< {
	returnTo: string;
	error?: string;
} | null > {
	if ( window.location.pathname !== CALLBACK_PATH ) {
		return null;
	}
	const params = new URLSearchParams( window.location.hash.slice( 1 ) );
	const returnTo = window.sessionStorage.getItem( RETURN_TO_KEY ) || '/';
	window.sessionStorage.removeItem( RETURN_TO_KEY );
	const token = params.get( 'access_token' );
	if ( ! token ) {
		return {
			returnTo,
			error:
				params.get( 'error_description' ) ?? params.get( 'error' ) ?? __( 'No token returned.' ),
		};
	}
	try {
		await new WpcomAuth().signIn( token );
		return { returnTo };
	} catch ( error ) {
		return { returnTo, error: error instanceof Error ? error.message : String( error ) };
	}
}
