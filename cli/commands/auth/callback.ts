import { URL } from 'url';
import { __ } from '@wordpress/i18n';
import { saveAuthenticationToken } from 'cli/lib/token-waiter';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

/**
 * Parse authentication data from OAuth callback URL
 */
function parseAuthCallbackUrl( callbackUrl: string ) {
	try {
		const url = new URL( callbackUrl );
		const params = new URLSearchParams( url.search );

		const accessToken = params.get( 'access_token' );
		const userId = params.get( 'user_id' );
		const email = params.get( 'email' );
		const displayName = params.get( 'display_name' );
		const expiresIn = params.get( 'expires_in' );

		if ( ! accessToken || ! userId ) {
			throw new Error( 'Missing required authentication parameters' );
		}

		return {
			access_token: accessToken,
			user_id: parseInt( userId, 10 ),
			email: email || undefined,
			display_name: displayName || undefined,
			expires_in: expiresIn ? parseInt( expiresIn, 10 ) : undefined,
		};
	} catch ( error ) {
		throw new LoggerError( __( 'Invalid authentication callback URL' ), error );
	}
}

export async function runCommand( callbackUrl: string ): Promise< void > {
	const logger = new Logger();

	try {
		logger.reportStart( 'AUTH_CALLBACK', __( 'Processing authentication callback…' ) );

		// Parse the callback URL to extract auth data
		const authData = parseAuthCallbackUrl( callbackUrl );

		// Save the authentication token to appdata
		await saveAuthenticationToken( authData );

		logger.reportSuccess( __( 'Authentication token saved successfully' ) );

		// Log user info if available
		if ( authData.email ) {
			console.log( __( 'Authenticated as:' ), authData.email );
		}
		if ( authData.display_name ) {
			console.log( __( 'Display name:' ), authData.display_name );
		}

		// Exit with success code
		process.exit( 0 );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Authentication callback failed' ), error ) );
		}

		// Exit with error code
		process.exit( 1 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'callback <url>',
		describe: __( 'Handle OAuth authentication callback (internal use)' ),
		builder: ( yargs ) => {
			return yargs.positional( 'url', {
				type: 'string',
				describe: __( 'OAuth callback URL' ),
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.url as string );
		},
	} );
};
