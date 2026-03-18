import { AUTH_EVENTS } from '@studio/common/lib/cli-events';
import { readAuthToken, updateSharedConfig } from '@studio/common/lib/shared-config';
import { AuthCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { revokeAuthToken } from 'cli/lib/api';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	logger.reportStart( LoggerAction.LOGOUT, __( 'Logging out…' ) );
	const token = await readAuthToken();

	if ( ! token ) {
		logger.reportSuccess( __( 'Already logged out' ) );
		return;
	}

	try {
		await revokeAuthToken( token.accessToken );
		await updateSharedConfig( { authToken: undefined } );
		await emitCliEvent( { event: AUTH_EVENTS.LOGOUT, data: {} } );

		logger.reportSuccess( __( 'Successfully logged out' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to log out' ), error ) );
		}
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
