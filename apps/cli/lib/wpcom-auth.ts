import { DEFAULT_TOKEN_LIFETIME_MS } from '@studio/common/constants';
import { AUTH_EVENTS } from '@studio/common/lib/cli-events';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { updateSharedConfig } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { getUserInfo } from 'cli/lib/api';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { getAppLocale } from 'cli/lib/i18n';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';

const CLI_REDIRECT_URI = `https://developer.wordpress.com/copy-oauth-token`;

// The authorization page shows the token for the user to copy back.
export async function getCliAuthenticationUrl(): Promise< string > {
	return getAuthenticationUrl( await getAppLocale(), CLI_REDIRECT_URI );
}

// Checks a pasted token against WordPress.com and stores it. Throws a
// user-facing LoggerError when it fails.
export async function storeAuthToken( accessToken: string ) {
	// `account_type` is absent throughout: the CLI has no signup path.
	const authProps = { ...getTracksOrigin(), source: 'cli' as const };

	let user: Awaited< ReturnType< typeof getUserInfo > >;
	try {
		user = await getUserInfo( accessToken );
	} catch {
		await recordTracksEvent( TRACKS_EVENTS.WPCOM_AUTH, {
			...authProps,
			success: false,
			failure_reason: 'profile_fetch_failed',
		} );
		throw new LoggerError( __( 'Authentication failed. Please try again.' ) );
	}

	const authToken = {
		accessToken,
		id: user.ID,
		email: user.email,
		displayName: user.display_name,
		expiresIn: DEFAULT_TOKEN_LIFETIME_MS / 1000,
		expirationTime: Date.now() + DEFAULT_TOKEN_LIFETIME_MS,
	};

	try {
		await updateSharedConfig( { authToken } );
	} catch ( error ) {
		await recordTracksEvent( TRACKS_EVENTS.WPCOM_AUTH, {
			...authProps,
			success: false,
			failure_reason: 'unknown',
		} );
		throw error instanceof LoggerError
			? error
			: new LoggerError( __( 'Authentication failed' ), error );
	}

	// After the token is stored — the wrapper reads it to resolve `is_a11n`.
	await recordTracksEvent( TRACKS_EVENTS.WPCOM_AUTH, { ...authProps, success: true } );

	try {
		await emitCliEvent( { event: AUTH_EVENTS.LOGIN, data: { token: authToken } } );
	} catch {
		// Best-effort: don't mask successful auth if event emission fails
	}
	return authToken;
}
