import * as Sentry from '@sentry/electron/main';
import { z } from 'zod';
import { CLIENT_ID } from 'common/constants';
import { SupportedLocale } from 'common/lib/locale';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { loadUserData, updateAppdata } from 'src/storage/user-data';

const authTokenSchema = z.object( {
	accessToken: z.string(),
	expiresIn: z.number(),
	expirationTime: z.number(),
	id: z.number(),
	email: z.string(),
	displayName: z.string().default( '' ),
} );

const meResponseSchema = z.object( {
	ID: z.number(),
	email: z.string(),
	display_name: z.string(),
} );

export type StoredToken = z.infer< typeof authTokenSchema >;

async function getToken(): Promise< StoredToken | null > {
	try {
		const userData = await loadUserData();
		return authTokenSchema.parse( userData.authToken );
	} catch ( error ) {
		return null;
	}
}

export function getSignUpUrl( locale: SupportedLocale ) {
	const oauth2Redirect = encodeURIComponent( getAuthenticationUrl( locale ) );
	return `https://wordpress.com/start/wpcc/oauth2-user?oauth2_client_id=${ CLIENT_ID }&oauth2_redirect=${ oauth2Redirect }&locale=${ locale }`;
}

export async function getAuthenticationToken(): Promise< StoredToken | null > {
	// Check if tokens already exist and are valid
	const existingToken = await getToken();
	if ( existingToken && new Date().getTime() < existingToken.expirationTime ) {
		return existingToken;
	}
	return null;
}

export async function isAuthenticated(): Promise< boolean > {
	const token = await getAuthenticationToken();
	return !! token;
}

async function handleAuthCallback( hash: string ): Promise< StoredToken > {
	const params = new URLSearchParams( hash.substring( 1 ) );
	const error = params.get( 'error' );

	if ( error ) {
		// Close the browser if code found or error
		throw new Error( error );
	}

	const accessToken = params.get( 'access_token' ) ?? '';
	const expiresIn = parseInt( params.get( 'expires_in' ) ?? '0' );

	if ( isNaN( expiresIn ) || expiresIn === 0 || ! accessToken ) {
		throw new Error( 'Error while getting token' );
	}
	const rawResponse = await wpcomFactory( accessToken, wpcomXhrRequest ).req.get(
		'/me?fields=ID,email,display_name'
	);

	const response = meResponseSchema.parse( rawResponse );

	return authTokenSchema.parse( {
		expiresIn,
		expirationTime: new Date().getTime() + expiresIn * 1000,
		accessToken,
		id: response.ID,
		email: response.email,
		displayName: response.display_name,
	} );
}

export async function onOpenUrlCallback( url: string ) {
	const urlObject = new URL( url );
	const { host, hash, searchParams } = urlObject;

	if ( host === 'auth' ) {
		try {
			const authResult = await handleAuthCallback( hash );
			await updateAppdata( { authToken: authResult } );
			void sendIpcEventToRenderer( 'auth-updated', { token: authResult } );
		} catch ( error ) {
			Sentry.captureException( error );
			void sendIpcEventToRenderer( 'auth-updated', { error } );
		}
	} else if ( host === 'sync-connect-site' ) {
		const remoteSiteId = parseInt( searchParams.get( 'remoteSiteId' ) ?? '' );
		const studioSiteId = searchParams.get( 'studioSiteId' );
		if ( remoteSiteId && studioSiteId ) {
			void sendIpcEventToRenderer( 'sync-connect-site', { remoteSiteId, studioSiteId } );
		}
	}
}
