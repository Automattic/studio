import { input } from '@inquirer/prompts';
import { DEFAULT_TOKEN_LIFETIME_MS } from '@studio/common/constants';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { readAuthToken, updateSharedConfig } from '@studio/common/lib/shared-config';
import { AuthCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getUserInfo } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { getAppLocale } from 'cli/lib/i18n';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const CLI_REDIRECT_URI = `https://developer.wordpress.com/copy-oauth-token`;

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	const existingToken = await readAuthToken();
	if ( existingToken ) {
		logger.reportSuccess( __( 'Already authenticated with WordPress.com' ) );
		return;
	}

	logger.reportStart( LoggerAction.LOGIN, __( 'Opening browser for authentication…' ) );

	const appLocale = await getAppLocale();
	const authUrl = getAuthenticationUrl( appLocale, CLI_REDIRECT_URI );

	try {
		await openBrowser( authUrl );
		logger.reportSuccess( __( 'Browser opened successfully' ) );
	} catch ( error ) {
		// If the browser fails to open, allow users to manually open the URL
		const loggerError = new LoggerError(
			sprintf( __( 'Failed to open browser. Please open the URL manually: %s' ), authUrl ),
			error
		);
		logger.reportError( loggerError );
	}

	console.log(
		__( 'Please complete authentication in your browser and paste the generated token here.' )
	);
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

	try {
		await updateSharedConfig( {
			authToken: {
				accessToken,
				id: user.ID,
				email: user.email,
				displayName: user.display_name,
				expiresIn: DEFAULT_TOKEN_LIFETIME_MS / 1000,
				expirationTime: Date.now() + DEFAULT_TOKEN_LIFETIME_MS,
			},
		} );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Authentication failed' ), error ) );
		}
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
