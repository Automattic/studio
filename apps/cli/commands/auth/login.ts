import { input } from '@inquirer/prompts';
import { DEFAULT_TOKEN_LIFETIME_MS } from '@studio/common/constants';
import { AUTH_EVENTS } from '@studio/common/lib/cli-events';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { readAuthToken, updateSharedConfig } from '@studio/common/lib/shared-config';
import { AuthCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { getUserInfo } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { getAppLocale } from 'cli/lib/i18n';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

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

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const existingToken = await readAuthToken();
		if ( existingToken ) {
			logger.reportSuccess( __( 'Already authenticated with WordPress.com' ) );
			return;
		}
	} catch ( error ) {
		logger.reportError(
			new LoggerError( error instanceof Error ? error.message : String( error ) )
		);
		return;
	}

	const authUrl = await getCliAuthenticationUrl();

	logger.reportStart( LoggerAction.LOGIN, __( 'Opening browser for authentication…' ) );
	try {
		await openBrowser( authUrl );
		logger.reportSuccess( __( 'Browser opened successfully' ) );
	} catch ( error ) {
		logger.reportWarning(
			__( "Couldn't open a browser automatically. Use the URL below instead." ) +
				( error instanceof Error ? `: ${ error.message }` : '' )
		);
	}

	// Always surface the URL explicitly so users on remote/headless machines
	// have a usable link to open on another device.
	console.log( '' );
	console.log( __( 'To authenticate, open this URL in a browser on any device:' ) );
	console.log( authUrl );
	console.log( '' );
	console.log( __( 'After approving access, copy the generated token and paste it here.' ) );
	console.log( '' );

	try {
		const accessToken = await input( { message: __( 'Authentication token:' ) } );
		await storeAuthToken( accessToken );
		logger.reportSuccess( __( 'Authentication completed successfully!' ) );
	} catch ( error ) {
		logger.reportError(
			error instanceof LoggerError ? error : new LoggerError( __( 'Authentication failed' ), error )
		);
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'login',
		describe: __( 'Log in to WordPress.com' ),
		builder: ( yargs ) => {
			return yargs.option( 'path', {
				hidden: true,
			} );
		},
		handler: async () => {
			await runCommand();
		},
	} );
};
