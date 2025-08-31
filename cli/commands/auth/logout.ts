import { __ } from '@wordpress/i18n';
import { readAppdata, saveAppdata, lockAppdata, unlockAppdata } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger();

	logger.reportStart( 'LOGOUT', __( 'Logging out…' ) );

	try {
		await lockAppdata();

		const userData = await readAppdata();

		if ( ! userData.authToken ) {
			logger.reportError( new LoggerError( __( 'Already logged out' ) ) );
			return;
		}

		delete userData.authToken;
		await saveAppdata( userData );

		logger.reportSuccess( __( 'Successfully logged out' ) );
		logger.reportKeyValuePair( 'status', __( 'Logged out' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to log out' ), error ) );
		}
		throw error;
	} finally {
		await unlockAppdata();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'logout',
		describe: __( 'Log out and clear authentication' ),
		handler: async () => {
			await runCommand();
		},
	} );
};
