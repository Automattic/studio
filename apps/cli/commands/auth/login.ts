import { readAuthToken } from '@studio/common/lib/shared-config';
import { AuthCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { signInInteractively } from 'cli/lib/wpcom-auth';
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

	logger.reportStart( LoggerAction.LOGIN, __( 'Opening browser for authentication…' ) );
	try {
		await signInInteractively();
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
