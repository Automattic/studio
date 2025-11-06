import path from 'path';
import { __ } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	startProxyProcess,
	isProxyProcessRunning,
	isDaemonRunning,
	startDaemon,
} from 'cli/lib/pm2-manager';
import { startProxyServers } from 'cli/lib/proxy-server';
import { isRunningAsRoot, getElevatedPrivilegesMessage } from 'cli/lib/sudo-exec';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

/**
 * Boot Command - Internal Use Only
 *
 * Ensures PM2 daemon and HTTP/HTTPS proxy are running.
 * This is idempotent - safe to call multiple times.
 *
 * Called by Studio automatically when custom domains are needed.
 */

export async function runCommand( managed: boolean ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		// If --managed flag is set, we're being run by PM2
		// Just start the proxy servers and keep the process alive
		if ( managed ) {
			logger.reportStart( LoggerAction.LOAD, __( 'Booting proxy servers...' ) );
			await startProxyServers();
			logger.reportSuccess( __( 'Proxy servers running' ) );
			// Process stays alive via process.stdin.resume() in startProxyServers()
			return;
		}

		// Verify this is being called by Studio (internal use only)
		if ( ! process.env.STUDIO_INTERNAL ) {
			console.warn( '⚠️  This is an internal Studio command.' );
			console.warn( '⚠️  It should only be called by the Studio application.' );
			console.warn( '' );
		}

		// Step 1: Ensure PM2 daemon is running
		if ( ! isDaemonRunning() ) {
			logger.reportStart( LoggerAction.LOAD, __( 'Starting PM2 daemon...' ) );
			await startDaemon();
			logger.reportSuccess( __( 'PM2 daemon started' ) );
		}

		// Step 2: Check if proxy is already running
		const isRunning = await isProxyProcessRunning();
		if ( isRunning ) {
			logger.reportSuccess( __( 'Proxy already running' ) );
			return;
		}

		// Step 3: Check for elevated privileges
		if ( ! isRunningAsRoot() ) {
			throw new Error( getElevatedPrivilegesMessage() );
		}

		// Step 4: Start proxy via PM2
		logger.reportStart( LoggerAction.LOAD, __( 'Starting proxy server...' ) );

		// Get the CLI path (current executable)
		// __dirname is dist/cli when running the bundled CLI
		const cliPath = path.resolve( __dirname, 'main.js' );

		await startProxyProcess( cliPath );

		logger.reportSuccess( __( 'Proxy server started' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to boot proxy infrastructure' ), error );
			logger.reportError( loggerError );
		}
		process.exit( 1 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'boot',
		hidden: true, // Don't show in help - internal command
		describe: __( 'Internal: Boot PM2 and proxy (Studio use only)' ),
		builder: ( yargs ) => {
			return yargs.option( 'managed', {
				type: 'boolean',
				default: false,
				hidden: true, // Internal flag used by PM2
				description: __( 'Run in managed mode (started by PM2)' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.managed as boolean );
		},
	} );
};
