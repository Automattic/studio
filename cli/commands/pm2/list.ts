import { __, _n, sprintf } from '@wordpress/i18n';
import Table from 'cli-table3';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { ensureDaemonRunning, listProcesses } from 'cli/lib/pm2-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( format: 'table' | 'json' ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.LOAD, __( 'Loading PM2 processes…' ) );
		await ensureDaemonRunning();
		const processes = await listProcesses();

		if ( processes.length === 0 ) {
			logger.reportSuccess( __( 'No processes found' ) );
			return;
		}

		const message = sprintf(
			_n( 'Found %d process', 'Found %d processes', processes.length ),
			processes.length
		);
		logger.reportSuccess( message );

		if ( format === 'table' ) {
			const table = new Table( {
				head: [ __( 'Name' ), __( 'PID' ), __( 'Status' ), __( 'Uptime' ) ],
				style: {
					head: [ 'cyan' ],
					border: [ 'grey' ],
				},
				wordWrap: true,
				wrapOnWordBoundary: false,
			} );

			processes.forEach( ( proc ) => {
				const uptimeSeconds = Math.floor( proc.pm2_env.uptime / 1000 );
				const uptimeMinutes = Math.floor( uptimeSeconds / 60 );
				const uptimeHours = Math.floor( uptimeMinutes / 60 );
				const uptimeDisplay =
					uptimeHours > 0
						? sprintf( '%dh %dm', uptimeHours, uptimeMinutes % 60 )
						: sprintf( '%dm %ds', uptimeMinutes, uptimeSeconds % 60 );

				table.push( [ proc.name, proc.pid.toString(), proc.status, uptimeDisplay ] );
			} );

			console.log( table.toString() );
		} else {
			const jsonOutput = processes.map( ( proc ) => ( {
				name: proc.name,
				pid: proc.pid,
				pm_id: proc.pm_id,
				status: proc.status,
				uptime: proc.pm2_env.uptime,
			} ) );
			console.log( JSON.stringify( jsonOutput, null, 2 ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to list PM2 processes' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List all PM2 processes' ),
		builder: ( yargs ) => {
			return yargs.option( 'format', {
				type: 'string',
				choices: [ 'table', 'json' ],
				default: 'table',
				description: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.format as 'table' | 'json' );
		},
	} );
};

