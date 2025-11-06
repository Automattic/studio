import { password } from '@inquirer/prompts';
import { __, sprintf } from '@wordpress/i18n';
import { SupportedLocale } from 'common/lib/locale';
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
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const CLI_REDIRECT_URI = `https://developer.wordpress.com/copy-oauth-token`;

export async function runCommand( locale: SupportedLocale = 'en' ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		await getAuthToken();
		logger.reportSuccess( __( 'Already authenticated with WordPress.com' ) );
		return;
	} catch ( error ) {
		// Assume the token is invalid and proceed with authentication
	}

	try {
		logger.reportStart( LoggerAction.LOGIN, __( 'Opening browser for authentication…' ) );

		const authUrl = getAuthenticationUrl( locale, CLI_REDIRECT_URI );

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

		console.log( __( 'Please complete authentication in your browser.' ) );
		console.log( '' );

		const accessToken = await password( { message: __( 'Authentication token:' ) } );
		const user = await getUserInfo( accessToken );

		logger.reportSuccess( __( 'Authentication completed successfully!' ) );

		try {
			await lockAppdata();
			const userData = await readAppdata();

			const now = new Date();
			const twoWeeksInSeconds = 2 * 7 * 24 * 60 * 60;

			userData.authToken = {
				accessToken,
				id: user.ID,
				email: user.email,
				displayName: user.display_name,
				expiresIn: twoWeeksInSeconds,
				expirationTime: now.getTime() + twoWeeksInSeconds,
			};

			await saveAppdata( userData );
		} finally {
			await unlockAppdata();
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Authentication failed' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv, locale: SupportedLocale ) => {
	return yargs.command( {
		command: 'login',
		describe: __( 'Log in to WordPress.com' ),
		handler: async () => {
			await runCommand( locale );
		},
	} );
};
