import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

export const STUDIO_CLI_HOME = path.join( os.homedir(), '.studio' );

/**
 * Where a process-manager daemon keeps its files and listens. `customHome` is the
 * STUDIO_PROCESS_MANAGER_HOME it runs with, if any.
 */
export function getProcessManagerPaths( customHome?: string ) {
	const home = customHome ?? path.join( STUDIO_CLI_HOME, 'daemon' );
	// Named pipes on Windows share one system-wide namespace, unlike the Unix sockets inside the
	// home. A daemon with its own home gets pipe names keyed to that home, so it never shares pipes
	// with another daemon. The default home keeps the original names, which already-running daemons
	// listen on.
	const windowsPipePrefix = customHome
		? `studio-${ createHash( 'sha256' ).update( home ).digest( 'hex' ).slice( 0, 12 ) }-`
		: 'studio-';
	const socketPath = ( name: string ) =>
		process.platform === 'win32'
			? `\\\\.\\pipe\\${ windowsPipePrefix }${ name }.sock`
			: path.join( home, `${ name }.sock` );
	return {
		home,
		windowsPipePrefix,
		controlSocketPath: socketPath( 'daemon' ),
		eventsSocketPath: socketPath( 'daemon-events' ),
	};
}

const processManagerPaths = getProcessManagerPaths( process.env.STUDIO_PROCESS_MANAGER_HOME );

export const PROCESS_MANAGER_HOME = processManagerPaths.home;
export const PROCESS_MANAGER_LOGS_DIR = path.join( PROCESS_MANAGER_HOME, 'logs' );
export const WINDOWS_PIPE_PREFIX = processManagerPaths.windowsPipePrefix;
export const PROCESS_MANAGER_CONTROL_SOCKET_PATH = processManagerPaths.controlSocketPath;
export const PROCESS_MANAGER_EVENTS_SOCKET_PATH = processManagerPaths.eventsSocketPath;
