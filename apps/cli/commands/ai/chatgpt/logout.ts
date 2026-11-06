import { disconnectChatGpt } from '@studio/agent/node/settings-store';
import { __ } from '@wordpress/i18n';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'logout',
		describe: __( 'Sign out of ChatGPT' ),
		handler: async () => {
			logger.reportStart( 'logout', __( 'Signing out of ChatGPT…' ) );
			try {
				await disconnectChatGpt();
			} catch ( error ) {
				logger.reportError( new LoggerError( __( 'Failed to sign out of ChatGPT' ), error ) );
				return;
			}
			logger.reportSuccess( __( 'Signed out of ChatGPT' ) );
		},
	} );
};
