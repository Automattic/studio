import { input } from '@inquirer/prompts';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { AuthCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { getCliAuthenticationUrl, storeAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

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
