import { ipcMain } from 'electron';
import * as Sentry from '@sentry/electron/main';
import wpcom from 'wpcom';
import { z } from 'zod';
import { PROTOCOL_PREFIX, WP_AUTHORIZE_ENDPOINT, CLIENT_ID, SCOPES } from '../constants';
import { shellOpenExternalWrapper } from '../lib/shell-open-external-wrapper';
import { getMainWindow } from '../main-window';
import { loadUserData, saveUserData } from '../storage/user-data';

const REDIRECT_URI = `${ PROTOCOL_PREFIX }://auth`;
const authTokenSchema = z.object( {
	accessToken: z.string(),
	expiresIn: z.number(),
	expirationTime: z.number(),
	id: z.number(),
	email: z.string(),
	displayName: z.string().optional(),
} );

export type StoredToken = z.infer< typeof authTokenSchema >;

async function getToken(): Promise< StoredToken | null > {
	try {
		const userData = await loadUserData();
		const parsed = authTokenSchema.parse( userData.authToken );
		return parsed;
	} catch ( error ) {
		return null;
	}
}

async function storeToken( tokens: StoredToken ) {
	try {
		const userData = await loadUserData();
		await saveUserData( {
			...userData,
			authToken: tokens,
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
			authToken: undefined,
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

	try {
		const response = await new wpcom( accessToken ).req.get( '/me?fields=ID,email,display_name' );

		return authTokenSchema.parse( {
			expiresIn,
			expirationTime: new Date().getTime() + expiresIn * 1000,
			accessToken,
			id: response.ID,
			email: response.email,
			displayName: response.display_name,
		} );
	} catch ( error ) {
		Sentry.captureException( error );
		throw error;
	}
}

export function authenticate(): void {
	const authUrl = `${ WP_AUTHORIZE_ENDPOINT }?response_type=token&client_id=${ CLIENT_ID }&redirect_uri=${ encodeURIComponent(
		REDIRECT_URI
	) }&scope=${ encodeURIComponent( SCOPES ) }`;

	shellOpenExternalWrapper( authUrl );
}

export async function onOpenUrlCallback( url: string ) {
	const urlObject = new URL( url );
	const { host, hash, searchParams } = urlObject;

	if ( host === 'auth' ) {
		handleAuthCallback( hash ).then( ( authResult ) => {
			if ( authResult instanceof Error ) {
				ipcMain.emit( 'auth-callback', null, { error: authResult } );
			} else {
				ipcMain.emit( 'auth-callback', null, { token: authResult } );
			}
		} );
	}

	if ( host === 'sync-connect-site' ) {
		const remoteSiteId = parseInt( searchParams.get( 'remoteSiteId' ) ?? '' );
		const studioSiteId = searchParams.get( 'studioSiteId' );
		if ( remoteSiteId && studioSiteId ) {
			const mainWindow = await getMainWindow();
			mainWindow.webContents.send( 'sync-connect-site', { remoteSiteId, studioSiteId } );
		}
	}
}

export function setUpAuthCallbackHandler() {
	ipcMain.on( 'auth-callback', async ( _event, { token, error } ) => {
		const mainWindow = await getMainWindow();
		if ( error ) {
			mainWindow.webContents.send( 'auth-updated', { error } );
		} else {
			await storeToken( token );
			mainWindow.webContents.send( 'auth-updated', { token } );
		}
	} );
}
