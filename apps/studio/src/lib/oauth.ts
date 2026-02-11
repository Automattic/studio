import { z } from 'zod';
import { CLIENT_ID } from '@studio/common/constants';
import { SupportedLocale } from '@studio/common/lib/locale';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { loadUserData } from 'src/storage/user-data';

const authTokenSchema = z.object( {
	accessToken: z.string(),
	expiresIn: z.number(),
	expirationTime: z.number(),
	id: z.number(),
	email: z.string(),
	displayName: z.string().default( '' ),
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
