import { __ } from '@wordpress/i18n';
import { AuthCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { revokeAuthToken } from 'cli/lib/api';
import {
	readAppdata,
	saveAppdata,
	lockAppdata,
	unlockAppdata,
	getAuthToken,
} from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	logger.reportStart( LoggerAction.LOGOUT, __( 'Logging out…' ) );
	let token: Awaited< ReturnType< typeof getAuthToken > >;

	try {
		token = await getAuthToken();
	} catch ( error ) {
		logger.reportSuccess( __( 'Already logged out' ) );
		return;
	}

	try {
		await lockAppdata();
		await revokeAuthToken( token.accessToken );
		const userData = await readAppdata();
		delete userData.authToken;
		await saveAppdata( userData );

		logger.reportSuccess( __( 'Successfully logged out' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to log out' ), error ) );
		}
	} finally {
		await unlockAppdata();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'logout',
		describe: __( 'Log out and clear WordPress.com authentication' ),
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
