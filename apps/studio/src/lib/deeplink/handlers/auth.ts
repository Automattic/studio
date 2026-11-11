import { dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { connectProvider } from '@studio/common/lib/ai-settings';
import { getAuthFailureReason, getAuthTracksProps } from '@studio/common/lib/auth-tracks';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getProvider } from '@studio/providers/services';
import { __ } from '@wordpress/i18n';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { takePendingAuthContext } from 'src/lib/auth-tracks-context';
import { setSentryWpcomUserIdMain } from 'src/lib/main-sentry-utils';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { getMainWindow } from 'src/main-window';

/**
 * Handles the OAuth authentication deeplink callback.
 * This function is called when the user completes authentication on WordPress.com
 * and is redirected back to the app via wp-studio://auth
 */
export async function handleAuthDeeplink( urlObject: URL ): Promise< void > {
	const { hash } = urlObject;
	// Taken once, up front, so both branches see it and it is consumed exactly once.
	const context = takePendingAuthContext(
		new URLSearchParams( hash.substring( 1 ) ).get( 'state' ) ??
			urlObject.searchParams.get( 'state' ) ??
			undefined
	);
	const authProps = getAuthTracksProps( context );

	try {
		await connectProvider(
			getProvider( 'wpcom' ),
			Object.fromEntries( new URLSearchParams( hash.substring( 1 ) ) )
		);
		const authResult = await readAuthToken();
		if ( ! authResult ) {
			throw new Error( 'The WordPress.com sign-in was not stored.' );
		}
		setSentryWpcomUserIdMain( authResult.id );
		// After the token is stored: the wrapper derives `is_a11n` from it, so recording earlier would
		// tag every Automattician's login as `false`.
		void recordTracksEvent( TRACKS_EVENTS.WPCOM_AUTH, { ...authProps, success: true } );
		void sendIpcEventToRenderer( 'auth-updated', { token: authResult } );
	} catch ( error ) {
		Sentry.captureException( error );
		const failureReason = getAuthFailureReason( error );
		void recordTracksEvent( TRACKS_EVENTS.WPCOM_AUTH, {
			...authProps,
			success: false,
			failure_reason: failureReason,
		} );
		const denied = failureReason === 'access_denied';
		await dialog.showMessageBox( await getMainWindow(), {
			type: 'error',
			message: denied ? __( 'Authorization denied' ) : __( 'Authentication error' ),
			detail: denied
				? __(
						'It looks like you denied the authorization request. To proceed, please click "Approve"'
				  )
				: __( 'Please try again.' ),
		} );
	}
}
