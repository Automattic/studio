import { __ } from '@wordpress/i18n';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { AuthCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { validateAccessToken } from 'cli/lib/api';
import { readAppdata } from 'cli/lib/appdata';
import { openInBrowser } from 'cli/lib/open-in-browser';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface AuthToken {
	accessToken: string;
	id: number;
	email?: string;
	displayName?: string;
	expiresIn?: number;
	expirationTime?: number;
}

async function waitForAuthentication( maxWaitSeconds = 300 ): Promise< AuthToken > {
	const startTime = Date.now();
	const maxWaitMs = maxWaitSeconds * 1000;
	let lastTokenState: string | undefined;

	while ( Date.now() - startTime < maxWaitMs ) {
		const userData = await readAppdata();
		const currentToken = userData.authToken?.accessToken;

		if ( currentToken && currentToken !== lastTokenState ) {
			await validateAccessToken( currentToken );
			return userData.authToken as AuthToken;
		}

		if ( lastTokenState === undefined ) {
			lastTokenState = currentToken;
		}

		await new Promise( ( resolve ) => setTimeout( resolve, 2000 ) );
	}

	throw new LoggerError( __( 'Authentication timeout. Please try again.' ) );
}

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.CHECK, __( 'Checking authentication status…' ) );

		const userData = await readAppdata();
		if ( userData.authToken?.accessToken ) {
			await validateAccessToken( userData.authToken.accessToken );
			logger.reportSuccess( __( 'Already authenticated' ) );

			if ( userData.authToken.email ) {
				console.log( __( 'Authenticated as:' ), userData.authToken.email );
			}
			return;
		}

		const authUrl = getAuthenticationUrl( 'en' );
		logger.reportStart( LoggerAction.BROWSER, __( 'Opening browser for authentication…' ) );
		openInBrowser( authUrl );

		console.log( __( 'Note: This will open the Studio app to complete authentication.' ) );
		console.log( __( "If the Studio app doesn't open automatically, please install it first." ) );

		logger.reportStart( LoggerAction.WAIT, __( 'Waiting for authentication to complete…' ) );
		const token = await waitForAuthentication();
		logger.reportSuccess( __( 'Authentication successful!' ) );

		if ( token.email ) {
			console.log( __( 'Authenticated as:' ), token.email );
		}
		if ( token.displayName ) {
			console.log( __( 'Display name:' ), token.displayName );
		}
	} catch ( error ) {
		const loggerError = new LoggerError( __( 'Authentication failed' ), error );
		logger.reportError( loggerError );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'login',
		describe: __( 'Authenticate with WordPress.com' ),
		handler: async () => {
			await runCommand();
		},
	} );
};
