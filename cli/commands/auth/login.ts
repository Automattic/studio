import { spawn } from 'child_process';
import { __ } from '@wordpress/i18n';
import { SupportedLocale } from 'common/lib/locale';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { validateAccessToken } from 'cli/lib/api';
import { readAppdata } from 'cli/lib/appdata';
import { registerProtocolHandler, unregisterProtocolHandler } from 'cli/lib/protocol-handler';
import { waitForAuthenticationToken, getAuthStartTimestamp } from 'cli/lib/token-waiter';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

async function openBrowser( url: string ): Promise< void > {
	const platform = process.platform;
	let cmd: string;
	let args: string[];

	switch ( platform ) {
		case 'darwin':
			cmd = 'open';
			args = [ url ];
			break;
		case 'win32':
			cmd = 'rundll32';
			args = [ 'url.dll,FileProtocolHandler', url ];
			break;
		default:
			cmd = 'xdg-open';
			args = [ url ];
			break;
	}

	return new Promise( ( resolve, reject ) => {
		const child = spawn( cmd, args );

		child.on( 'error', ( error ) => {
			reject(
				new LoggerError( __( 'Failed to open browser. Please open the URL manually.' ), error )
			);
		} );

		child.on( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve();
			} else {
				reject( new LoggerError( __( 'Failed to open browser. Please open the URL manually.' ) ) );
			}
		} );
	} );
}

export async function runCommand( locale: SupportedLocale = 'en' ): Promise< void > {
	const logger = new Logger();

	try {
		const existingData = await readAppdata();
		if ( existingData.authToken?.accessToken ) {
			await validateAccessToken( existingData.authToken.accessToken );
			logger.reportSuccess( __( 'Already authenticated with WordPress.com' ) );
			return;
		}

		logger.reportStart( 'AUTH_INIT', __( 'Starting authentication flow…' ) );

		// Get timestamp before starting auth to detect new tokens
		const authStartTime = getAuthStartTimestamp();

		// Register CLI as temporary protocol handler
		logger.reportStart( 'PROTOCOL_REGISTER', __( 'Registering CLI as protocol handler…' ) );
		await registerProtocolHandler();
		logger.reportSuccess( __( 'Protocol handler registered' ) );

		logger.reportStart( 'BROWSER_OPEN', __( 'Opening browser for authentication…' ) );
		const authUrl = getAuthenticationUrl( locale );
		await openBrowser( authUrl );
		logger.reportSuccess( __( 'Browser opened successfully' ) );

		console.log( __( 'Please complete authentication in your browser.' ) );
		console.log( '' );

		const authToken = await waitForAuthenticationToken( authStartTime, 120000, logger );
		await unregisterProtocolHandler();
		logger.reportSuccess( __( 'Authentication completed successfully!' ) );
		logger.reportKeyValuePair( 'status', __( 'Authenticated' ) );
		logger.reportKeyValuePair( 'user_id', authToken.id.toString() );
		logger.reportKeyValuePair( 'email', authToken.email );
		logger.reportKeyValuePair( 'display_name', authToken.displayName );
	} catch ( error ) {
		// Clean up protocol registration on error
		await unregisterProtocolHandler();

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
