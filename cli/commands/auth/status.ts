import { __ } from '@wordpress/i18n';
import { AuthCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { validateAccessToken } from 'cli/lib/api';
import { readAppdata } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.CHECK, __( 'Checking authentication status…' ) );

		const userData = await readAppdata();

		if ( ! userData.authToken?.accessToken ) {
			logger.reportSuccess( __( 'Not authenticated' ) );
			console.log( __( 'Use "studio auth login" to authenticate.' ) );
			return;
		}

		try {
			await validateAccessToken( userData.authToken.accessToken );
			logger.reportSuccess( __( 'Authenticated and token is valid' ) );

			if ( userData.authToken.email ) {
				console.log( __( 'Email:' ), userData.authToken.email );
			}
			if ( userData.authToken.displayName ) {
				console.log( __( 'Display name:' ), userData.authToken.displayName );
			}
			if ( userData.authToken.id ) {
				console.log( __( 'User ID:' ), userData.authToken.id );
			}
		} catch {
			logger.reportError( new LoggerError( __( 'Authentication token is invalid or expired' ) ) );
			console.log( __( 'Use "studio auth login" to re-authenticate.' ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to check authentication status' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status',
		describe: __( 'Check authentication status' ),
		handler: async () => {
			await runCommand();
		},
	} );
};
