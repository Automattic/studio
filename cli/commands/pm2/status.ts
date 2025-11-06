import { __, _n, sprintf } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { isDaemonRunning, listProcesses } from 'cli/lib/pm2-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.LOAD, __( 'Checking PM2 daemon status…' ) );

		if ( ! isDaemonRunning() ) {
			logger.reportSuccess( __( 'PM2 daemon is not running' ) );
			return;
		}

		const processes = await listProcesses( false );

		const message = sprintf(
			_n( 'PM2 daemon is running (%d process)', 'PM2 daemon is running (%d processes)', processes.length ),
			processes.length
		);
		logger.reportSuccess( message );

		if ( processes.length > 0 ) {
			processes.forEach( ( proc ) => {
				logger.reportKeyValuePair( proc.name, sprintf( 'pid: %d, status: %s', proc.pid, proc.status ) );
			} );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to check PM2 daemon status' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status',
		describe: __( 'Check PM2 daemon status and list processes' ),
		handler: async () => {
			await runCommand();
		},
	} );
};

