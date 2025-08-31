import { __ } from '@wordpress/i18n';
import { validateAccessToken } from 'cli/lib/api';
import { readAppdata } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger();

	try {
		logger.reportStart( 'STATUS_CHECK', __( 'Checking authentication status…' ) );

		const userData = await readAppdata();

		if ( ! userData.authToken?.accessToken ) {
			logger.reportError( new LoggerError( __( 'Not authenticated' ) ) );
			logger.reportKeyValuePair( 'status', __( 'Not authenticated' ) );
			logger.reportKeyValuePair( 'suggestion', __( 'Run "studio auth login" to authenticate' ) );
			return;
		}

		try {
			await validateAccessToken( userData.authToken.accessToken );

			const WPCOM = require( 'wpcom' );
			const wpcom = new WPCOM( userData.authToken.accessToken );
			const user = await wpcom.req.get( '/me', { fields: 'ID,login,email,display_name' } );

			logger.reportSuccess( __( 'Successfully authenticated with WordPress.com' ) );
			logger.reportKeyValuePair( 'status', __( 'Authenticated' ) );
			logger.reportKeyValuePair( 'user_id', user.ID.toString() );
			logger.reportKeyValuePair( 'username', user.login );
			logger.reportKeyValuePair( 'display_name', user.display_name );
			logger.reportKeyValuePair( 'email', user.email );
		} catch {
			logger.reportError( new LoggerError( __( 'Authentication token is invalid or expired' ) ) );
			logger.reportKeyValuePair( 'status', __( 'Invalid token' ) );
			logger.reportKeyValuePair( 'suggestion', __( 'Run "studio auth login" to re-authenticate' ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to check authentication status' ), error ) );
		}
		logger.reportKeyValuePair( 'status', __( 'Error' ) );
		logger.reportKeyValuePair( 'suggestion', __( 'Run "studio auth login" to authenticate' ) );
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
