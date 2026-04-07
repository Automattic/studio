import * as Sentry from '@sentry/electron/main';
import { updateSharedConfig, authTokenSchema } from '@studio/common/lib/shared-config';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { z } from 'zod';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { setSentryWpcomUserIdMain } from 'src/lib/main-sentry-utils';

const meResponseSchema = z.object( {
	ID: z.number(),
	email: z.string(),
	display_name: z.string(),
} );

type StoredAuthToken = z.infer< typeof authTokenSchema >;

async function handleAuthCallback( hash: string ): Promise< StoredAuthToken > {
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

/**
 * Handles the OAuth authentication deeplink callback.
 * This function is called when the user completes authentication on WordPress.com
 * and is redirected back to the app via wp-studio://auth
 */
export async function handleAuthDeeplink( urlObject: URL ): Promise< void > {
	const { hash } = urlObject;
	try {
		const authResult = await handleAuthCallback( hash );
		await updateSharedConfig( { authToken: authResult } );
		setSentryWpcomUserIdMain( authResult.id );
		void sendIpcEventToRenderer( 'auth-updated', { token: authResult } );
	} catch ( error ) {
		Sentry.captureException( error );
		void sendIpcEventToRenderer( 'auth-updated', { error } );
	}
}
