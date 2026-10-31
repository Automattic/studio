import { DEFAULT_TOKEN_LIFETIME_MS } from '@studio/common/constants';
import { AUTH_EVENTS } from '@studio/common/lib/cli-events';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import {
	readAuthToken,
	updateSharedConfig,
	type StoredAuthToken,
} from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { getUserInfo } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { getAppLocale } from 'cli/lib/i18n';
import { input } from 'cli/lib/prompts';
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

/**
 * Signs in through the browser: opens the authorization page, shows its URL for headless machines,
 * and stores the token the user pastes back. Throws a user-facing LoggerError when it fails.
 */
export async function signInInteractively(): Promise< StoredAuthToken > {
	const authUrl = await getCliAuthenticationUrl();
	try {
		await openBrowser( authUrl );
	} catch {
		// The URL below works on any device.
	}

	console.log( '' );
	console.log( __( 'To authenticate, open this URL in a browser on any device:' ) );
	console.log( authUrl );
	console.log( '' );
	console.log( __( 'After approving access, copy the generated token and paste it here.' ) );
	console.log( '' );

	const accessToken = await input( { message: __( 'Authentication token:' ) } );
	return storeAuthToken( accessToken );
}

/**
 * Returns the stored WordPress.com token. When there is none and someone is at the terminal, signs
 * them in and carries on with the command instead of failing; otherwise (the app, agents, scripts)
 * throws a LoggerError tagged with `failureCode`.
 */
export async function requireAuthToken(
	failureCode = 'auth_required'
): Promise< StoredAuthToken > {
	const token = await readAuthToken();
	if ( token ) {
		return token;
	}
	if ( process.stdin.isTTY && process.stdout.isTTY ) {
		console.log( __( 'This command needs you to be logged in to WordPress.com.' ) );
		return signInInteractively();
	}
	throw new LoggerError(
		__( 'Authentication required. Please log in with `studio auth login`.' ),
		undefined,
		failureCode
	);
}
