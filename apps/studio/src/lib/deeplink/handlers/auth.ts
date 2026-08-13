import * as Sentry from '@sentry/electron/main';
import { updateSharedConfig, authTokenSchema } from '@studio/common/lib/shared-config';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { z } from 'zod';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { takePendingAuthContext } from 'src/lib/auth-tracks-context';
import { setSentryWpcomUserIdMain } from 'src/lib/main-sentry-utils';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import type { TracksAuthFailureReason } from 'src/lib/tracks';

const meResponseSchema = z.object( {
	ID: z.number(),
	email: z.string(),
	display_name: z.string(),
} );

type StoredAuthToken = z.infer< typeof authTokenSchema >;

// Tags the failure so Tracks can classify it without matching on the message text. The messages
// themselves are unchanged — the renderer still recognises `access_denied` by substring.
class AuthCallbackError extends Error {
	constructor(
		message: string,
		public readonly code: TracksAuthFailureReason
	) {
		super( message );
	}
}

function classifyAuthFailure( error: unknown ): TracksAuthFailureReason {
	return error instanceof AuthCallbackError ? error.code : 'profile_fetch_failed';
}

async function handleAuthCallback( hash: string ): Promise< StoredAuthToken > {
	const params = new URLSearchParams( hash.substring( 1 ) );
	const error = params.get( 'error' );

	if ( error ) {
		// Close the browser if code found or error
		throw new AuthCallbackError(
			error,
			error === 'access_denied' ? 'access_denied' : 'token_error'
		);
	}

	const accessToken = params.get( 'access_token' ) ?? '';
	const expiresIn = parseInt( params.get( 'expires_in' ) ?? '0' );

	if ( isNaN( expiresIn ) || expiresIn === 0 || ! accessToken ) {
		throw new AuthCallbackError( 'Error while getting token', 'token_error' );
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
	// Taken once, up front, so both branches see it and it is consumed exactly once.
	const context = takePendingAuthContext();
	const authProps = {
		source: context?.source ?? 'unknown',
		account_type: context?.accountType,
	};

	try {
		const authResult = await handleAuthCallback( hash );
		await updateSharedConfig( { authToken: authResult } );
		setSentryWpcomUserIdMain( authResult.id );
		// After the token is stored: the wrapper derives `is_a11n` from it, so recording earlier would
		// tag every Automattician's login as `false`.
		void recordTracksEvent( TRACKS_EVENTS.WPCOM_AUTH, { ...authProps, success: true } );
		void sendIpcEventToRenderer( 'auth-updated', { token: authResult } );
	} catch ( error ) {
		Sentry.captureException( error );
		void recordTracksEvent( TRACKS_EVENTS.WPCOM_AUTH, {
			...authProps,
			success: false,
			failure_reason: classifyAuthFailure( error ),
		} );
		void sendIpcEventToRenderer( 'auth-updated', { error } );
	}
}
