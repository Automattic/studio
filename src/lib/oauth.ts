import { ipcMain, shell, BrowserWindow } from 'electron';
import * as Sentry from '@sentry/electron/main';
import wpcom from 'wpcom';
import { loadUserData, saveUserData } from '../storage/user-data';

export interface StoredToken {
	accessToken?: string;
	expiresIn?: number;
	expirationTime?: number;
	email?: string;
	displayName?: string;
}

export const PROTOCOL_PREFIX = 'wpcom-local-dev';

const WP_AUTHORIZE_ENDPOINT = 'https://public-api.wordpress.com/oauth2/authorize';
const CLIENT_ID = '95109';
const REDIRECT_URI = `${ PROTOCOL_PREFIX }://auth`;

const SCOPES = 'global';
const TOKEN_KEY = 'authToken';

async function getToken(): Promise< StoredToken | null > {
	try {
		const userData = await loadUserData();
		return userData[ TOKEN_KEY ] ?? null;
	} catch ( error ) {
		return null;
	}
}

async function storeToken( tokens: StoredToken ) {
	try {
		const userData = await loadUserData();
		await saveUserData( {
			...userData,
			[ TOKEN_KEY ]: tokens,
		} );
	} catch ( error ) {
		console.error( 'Failed to store token', error );
	}
}

export async function clearAuthenticationToken() {
	try {
		const userData = await loadUserData();
		await saveUserData( {
			...userData,
			[ TOKEN_KEY ]: undefined,
		} );
	} catch ( error ) {
		return;
	}
}

export async function getAuthenticationToken(): Promise< StoredToken | null > {
	// Check if tokens already exist and are valid
	const existingToken = await getToken();
	if (
		existingToken?.accessToken &&
		new Date().getTime() < ( existingToken?.expirationTime ?? 0 )
	) {
		return existingToken;
	}
	return null;
}

export async function isAuthenticated(): Promise< boolean > {
	const token = await getAuthenticationToken();
	return !! token;
}

export async function handleAuthCallback( hash: string ): Promise< Error | StoredToken > {
	const params = new URLSearchParams( hash.substring( 1 ) );
	const error = params.get( 'error' );
	if ( error ) {
		// Close the browser if code found or error
		return new Error( error );
	}
	const accessToken = params.get( 'access_token' ) ?? '';
	const expiresIn = parseInt( params.get( 'expires_in' ) ?? '0' );
	if ( isNaN( expiresIn ) || expiresIn === 0 || ! accessToken ) {
		return new Error( 'Error while getting token' );
	}
	let response: { email?: string; display_name?: string } = {};
	try {
		response = await new wpcom( accessToken ).req.get( '/me?fields=email,display_name' );
	} catch ( error ) {
		Sentry.captureException( error );
	}
	return {
		expiresIn,
		expirationTime: new Date().getTime() + expiresIn * 1000,
		accessToken,
		email: response.email,
		displayName: response.display_name,
	};
}

export function authenticate(): void {
	const authUrl = `${ WP_AUTHORIZE_ENDPOINT }?response_type=token&client_id=${ CLIENT_ID }&redirect_uri=${ encodeURIComponent(
		REDIRECT_URI
	) }&scope=${ encodeURIComponent( SCOPES ) }`;
	shell.openExternal( authUrl );
}

export function setupAuthCallbackHandler( mainWindow: BrowserWindow ) {
	ipcMain.on( 'auth-callback', ( event, { token, error } ) => {
		if ( error ) {
			mainWindow?.webContents.send( 'auth-updated', { error: error } );
		} else {
			storeToken( token ).then( () => {
				mainWindow?.webContents.send( 'auth-updated', { token } );
			} );
		}
	} );
}
