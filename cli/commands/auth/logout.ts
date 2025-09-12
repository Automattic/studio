import { __ } from '@wordpress/i18n';
import { AuthCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata, saveAppdata, lockAppdata, unlockAppdata } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.CHECK, __( 'Checking authentication status…' ) );
		const userData = await readAppdata();

		if ( ! userData.authToken?.accessToken ) {
			logger.reportSuccess( __( 'Not currently authenticated' ) );
			return;
		}

		logger.reportSuccess( __( 'Currently authenticated' ) );

		logger.reportStart( LoggerAction.LOGOUT, __( 'Clearing authentication token…' ) );

		try {
			await lockAppdata();
			const updatedUserData = { ...userData, authToken: undefined };
			await saveAppdata( updatedUserData );
			logger.reportSuccess( __( 'Successfully logged out' ) );
		} finally {
			await unlockAppdata();
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Logout failed' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'logout',
		describe: __( 'Clear WordPress.com authentication' ),
		handler: async () => {
			await runCommand();
		},
	} );
};
