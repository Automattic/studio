import { input } from '@inquirer/prompts';
import { __, sprintf } from '@wordpress/i18n';
import { DEFAULT_TOKEN_LIFETIME_MS } from 'common/constants';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { AuthCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getUserInfo } from 'cli/lib/api';
import {
	getAuthToken,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { getAppLocale } from 'cli/lib/i18n';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const CLI_REDIRECT_URI = `https://developer.wordpress.com/copy-oauth-token`;

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		await getAuthToken();
		logger.reportSuccess( __( 'Already authenticated with WordPress.com' ) );
		return;
	} catch ( error ) {
		// Assume the token is invalid and proceed with authentication
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
		await lockAppdata();
		const userData = await readAppdata();

		userData.authToken = {
			accessToken,
			id: user.ID,
			email: user.email,
			displayName: user.display_name,
			expiresIn: DEFAULT_TOKEN_LIFETIME_MS / 1000,
			expirationTime: Date.now() + DEFAULT_TOKEN_LIFETIME_MS,
		};

		await saveAppdata( userData );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Authentication failed' ), error ) );
		}
	} finally {
		await unlockAppdata();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'login',
		describe: __( 'Log in to WordPress.com' ),
		handler: async () => {
			await runCommand();
		},
	} );
};
