import { password } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import { SupportedLocale } from 'common/lib/locale';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { AuthCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { z } from 'zod';
import { validateAccessToken } from 'cli/lib/api';
import { lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const meResponseSchema = z.object( {
	ID: z.number(),
	email: z.string().email(),
	display_name: z.string(),
} );

const CLI_REDIRECT_URI = `https://developer.wordpress.com/copy-oauth-token`;

export async function runCommand( locale: SupportedLocale = 'en' ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const existingData = await readAppdata();
		if ( existingData.authToken?.accessToken ) {
			await validateAccessToken( existingData.authToken.accessToken );
			logger.reportSuccess( __( 'Already authenticated with WordPress.com' ) );
			return;
		}

		logger.reportStart( LoggerAction.LOGIN, __( 'Opening browser for authentication…' ) );

		const authUrl = getAuthenticationUrl( locale, CLI_REDIRECT_URI );
		await openBrowser( authUrl );
		logger.reportSuccess( __( 'Browser opened successfully' ) );

		console.log( __( 'Please complete authentication in your browser.' ) );
		console.log( '' );

		const accessToken = await password( {
			message: __( 'Authentication token:' ),
		} );

		logger.reportSuccess( __( 'Authentication completed successfully!' ) );

		const wpcom = wpcomFactory( accessToken, wpcomXhrRequest );
		const rawResponse = await wpcom.req.get( '/me', { fields: 'ID,login,email,display_name' } );
		const user = meResponseSchema.parse( rawResponse );

		const now = new Date();
		const twoWeeksInSeconds = 2 * 7 * 24 * 60 * 60;

		try {
			await lockAppdata();
			const userData = await readAppdata();
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

		logger.reportKeyValuePair( 'email', user.email );
		logger.reportKeyValuePair( 'display_name', user.display_name );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Authentication failed' ), error ) );
		}
		throw error;
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'login',
		describe: __( 'Log in to WordPress.com' ),
		builder: ( yargs ) => {
			return yargs.option( 'locale', {
				type: 'string',
				default: 'en',
				description: __( 'Locale for the authentication flow' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.locale as SupportedLocale );
		},
	} );
};
