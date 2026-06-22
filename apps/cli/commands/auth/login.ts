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
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const CLI_REDIRECT_URI = `https://developer.wordpress.com/copy-oauth-token`;

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

	const appLocale = await getAppLocale();
	const authUrl = getAuthenticationUrl( appLocale, CLI_REDIRECT_URI );

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

	let accessToken: Awaited< ReturnType< typeof input > >;
	let user: Awaited< ReturnType< typeof getUserInfo > >;

	try {
		accessToken = await input( { message: __( 'Authentication token:' ) } );
		user = await getUserInfo( accessToken );
		logger.reportSuccess( __( 'Authentication completed successfully!' ) );
	} catch ( error ) {
		logger.reportError( new LoggerError( __( 'Authentication failed. Please try again.' ) ) );
		return;
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
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Authentication failed' ), error ) );
		}
		return;
	}

	try {
		await emitCliEvent( { event: AUTH_EVENTS.LOGIN, data: { token: authToken } } );
	} catch {
		// Best-effort: don't mask successful auth if event emission fails
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
