import path from 'path';
import { __ } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	isDaemonRunning,
	startDaemon,
	isProxyProcessRunning,
	startProxyProcess,
} from 'cli/lib/pm2-manager';
import { isRunningAsRoot, getElevatedPrivilegesMessage } from 'cli/lib/sudo-exec';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		// Step 1: Ensure PM2 daemon is running
		if ( ! isDaemonRunning() ) {
			logger.reportStart( LoggerAction.LOAD, __( 'Starting PM2 daemon...' ) );
			await startDaemon();
			logger.reportSuccess( __( 'PM2 daemon started' ) );
		}

		// Step 2: Check if proxy is already running
		const isRunning = await isProxyProcessRunning();
		if ( isRunning ) {
			logger.reportSuccess( __( 'HTTP proxy already running' ) );
			return;
		}

		// Step 3: Check for elevated privileges
		if ( ! isRunningAsRoot() ) {
			throw new Error( getElevatedPrivilegesMessage() );
		}

		// Step 4: Start proxy via PM2
		logger.reportStart( LoggerAction.LOAD, __( 'Starting HTTP proxy server...' ) );

		// Get the proxy daemon path (cli/proxy-daemon.ts compiled to dist)
		// __dirname is dist/cli when running the bundled CLI
		const proxyDaemonPath = path.resolve( __dirname, 'proxy-daemon.js' );

		await startProxyProcess( proxyDaemonPath );

		logger.reportSuccess( __( 'HTTP proxy server started' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to start site infrastructure' ), error );
			logger.reportError( loggerError );
		}
		process.exit( 1 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'start',
		describe: __( 'Start the HTTP proxy for custom domains (requires sudo)' ),
		handler: async () => {
			await runCommand();
		},
	} );
};
