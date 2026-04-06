import type { AuthUser, Connector, SiteDetails } from '../../types';

const AUTH_TOKEN_KEY = 'studio_auth_token';
const AUTH_USER_KEY = 'studio_auth_user';

const CLIENT_ID = '136683';
const OAUTH_AUTHORIZE_URL = 'https://public-api.wordpress.com/oauth2/authorize';
const WPCOM_API_BASE = 'https://public-api.wordpress.com';
const TELEX_API_BASE = 'https://telex.automattic.ai';

interface StoredToken {
	accessToken: string;
	expirationTime: number;
}

interface TelexProjectSummary {
	publicId: string;
	name: string;
	slug: string;
	projectType: string | null;
}

interface TelexProjectListResponse {
	projects: TelexProjectSummary[];
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
}

function getRedirectUri(): string {
	return `${ window.location.origin }/auth/callback`;
}

function getStoredToken(): StoredToken | null {
	const raw = localStorage.getItem( AUTH_TOKEN_KEY );
	if ( ! raw ) {
		return null;
	}
	try {
		const token: StoredToken = JSON.parse( raw );
		if ( Date.now() >= token.expirationTime ) {
			localStorage.removeItem( AUTH_TOKEN_KEY );
			localStorage.removeItem( AUTH_USER_KEY );
			return null;
		}
		return token;
	} catch {
		return null;
	}
}

function getStoredUser(): AuthUser | null {
	const raw = localStorage.getItem( AUTH_USER_KEY );
	if ( ! raw ) {
		return null;
	}
	try {
		return JSON.parse( raw );
	} catch {
		return null;
	}
}

/**
 * Fetches the current user's profile from WordPress.com using the access token.
 */
async function fetchWpcomUser( accessToken: string ): Promise< AuthUser > {
	const res = await fetch( `${ WPCOM_API_BASE }/rest/v1.1/me?fields=ID,email,display_name`, {
		headers: { Authorization: `Bearer ${ accessToken }` },
	} );
	if ( ! res.ok ) {
		throw new Error( `Failed to fetch user: ${ res.status }` );
	}
	const data = await res.json();
	return {
		id: data.ID,
		email: data.email,
		displayName: data.display_name,
	};
}

/**
 * Handles the OAuth callback by extracting the token from the URL hash.
 * Called before React mounts to avoid router parsing issues.
 */
export async function handleOAuthCallback( hash: string ): Promise< void > {
	const params = new URLSearchParams( hash.substring( 1 ) );
	const error = params.get( 'error' );

	if ( error ) {
		throw new Error( error );
	}

	const accessToken = params.get( 'access_token' ) ?? '';
	const expiresIn = parseInt( params.get( 'expires_in' ) ?? '0' );

	if ( ! accessToken || isNaN( expiresIn ) || expiresIn === 0 ) {
		throw new Error( 'Invalid OAuth response' );
	}

	const token: StoredToken = {
		accessToken,
		expirationTime: Date.now() + expiresIn * 1000,
	};

	const user = await fetchWpcomUser( accessToken );

	localStorage.setItem( AUTH_TOKEN_KEY, JSON.stringify( token ) );
	localStorage.setItem( AUTH_USER_KEY, JSON.stringify( user ) );
}

function mapProjectToSite( project: TelexProjectSummary ): SiteDetails {
	return {
		id: project.publicId,
		name: project.name,
		path: project.slug,
		port: 0,
		running: false,
		phpVersion: '',
	};
}

/**
 * Creates a connector backed by the Telex API.
 * Uses WordPress.com OAuth tokens for authentication.
 */
export function createRestConnector(): Connector {
	async function telexApi< T >( path: string, options?: RequestInit ): Promise< T > {
		const token = getStoredToken();
		if ( ! token ) {
			throw new Error( 'Not authenticated' );
		}

		const res = await fetch( `${ TELEX_API_BASE }${ path }`, {
			...options,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ token.accessToken }`,
				...options?.headers,
			},
		} );
		if ( ! res.ok ) {
			throw new Error( `API error: ${ res.status }` );
		}
		return res.json();
	}

	return {
		// Auth — mandatory for web
		requiresAuth: true,

		async isAuthenticated(): Promise< boolean > {
			return getStoredToken() !== null;
		},

		async getAuthUser(): Promise< AuthUser | null > {
			return getStoredUser();
		},

		async authenticate(): Promise< void > {
			const url = new URL( OAUTH_AUTHORIZE_URL );
			url.searchParams.set( 'response_type', 'token' );
			url.searchParams.set( 'client_id', CLIENT_ID );
			url.searchParams.set( 'redirect_uri', getRedirectUri() );
			url.searchParams.set( 'scope', 'global' );
			window.location.href = url.toString();
		},

		async logout(): Promise< void > {
			localStorage.removeItem( AUTH_TOKEN_KEY );
			localStorage.removeItem( AUTH_USER_KEY );
		},

		// Sites — backed by Telex projects API
		async getSites(): Promise< SiteDetails[] > {
			const data = await telexApi< TelexProjectListResponse >( '/api/v1/projects' );
			return data.projects.map( mapProjectToSite );
		},

		async createSite( params ) {
			// Project creation in Telex is done via the agent API.
			// For now, this is a placeholder.
			throw new Error( `createSite not yet implemented (requested: ${ params.name })` );
		},

		async deleteSite( id ) {
			throw new Error( `deleteSite not yet implemented (id: ${ id })` );
		},

		async startSite( id ) {
			throw new Error( `startSite not yet implemented (id: ${ id })` );
		},

		async stopSite( id ) {
			throw new Error( `stopSite not yet implemented (id: ${ id })` );
		},
	};
}
