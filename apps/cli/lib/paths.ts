import crypto from 'crypto';
import os from 'os';
import path from 'path';

export const STUDIO_CLI_HOME = path.join( os.homedir(), '.studio' );

export const DEFAULT_PROCESS_MANAGER_HOME = path.join( STUDIO_CLI_HOME, 'daemon' );

export const PROCESS_MANAGER_HOME =
	process.env.STUDIO_PROCESS_MANAGER_HOME ?? DEFAULT_PROCESS_MANAGER_HOME;
export const PROCESS_MANAGER_LOGS_DIR = path.join( PROCESS_MANAGER_HOME, 'logs' );

// Windows named pipes live in a single, flat, machine-global namespace — unlike Unix domain sockets,
// they can't be nested under PROCESS_MANAGER_HOME. A fixed pipe name therefore makes every process on
// the machine bind/connect to the SAME daemon regardless of PROCESS_MANAGER_HOME, silently defeating
// the per-run isolation that setting STUDIO_PROCESS_MANAGER_HOME gives on macOS/Linux (and that the CLI
// test harness relies on). Derive the pipe name from the home when a custom one is set, so isolation
// works on Windows too. The default home keeps its original fixed name, so the shipping desktop app and
// CLI still share a single daemon exactly as before.
export function daemonPipePath( baseName: string, home: string = PROCESS_MANAGER_HOME ): string {
	if ( home === DEFAULT_PROCESS_MANAGER_HOME ) {
		return `\\\\.\\pipe\\${ baseName }.sock`;
	}
	const homeHash = crypto.createHash( 'sha1' ).update( home ).digest( 'hex' ).slice( 0, 12 );
	return `\\\\.\\pipe\\${ baseName }-${ homeHash }.sock`;
}

export const PROCESS_MANAGER_CONTROL_SOCKET_PATH =
	process.platform === 'win32'
		? daemonPipePath( 'studio-daemon' )
		: path.join( PROCESS_MANAGER_HOME, 'daemon.sock' );
export const PROCESS_MANAGER_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? daemonPipePath( 'studio-daemon-events' )
		: path.join( PROCESS_MANAGER_HOME, 'daemon-events.sock' );
