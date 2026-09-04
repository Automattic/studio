import crypto from 'crypto';
import os from 'os';
import path from 'path';

export const STUDIO_CLI_HOME = path.join( os.homedir(), '.studio' );

export const PROCESS_MANAGER_HOME =
	process.env.STUDIO_PROCESS_MANAGER_HOME ?? path.join( STUDIO_CLI_HOME, 'daemon' );
export const PROCESS_MANAGER_LOGS_DIR = path.join( PROCESS_MANAGER_HOME, 'logs' );

/**
 * Windows named pipes share one flat namespace, so a custom daemon home (used by the CLI e2e
 * harness to isolate each run) needs pipe names of its own. Otherwise every run, and the
 * developer's real Studio daemon, would silently share a single daemon. The default home keeps
 * the historical names so a daemon left running by an older CLI is still found.
 */
export function getWindowsPipePath( name: string ): string {
	const suffix = process.env.STUDIO_PROCESS_MANAGER_HOME
		? `-${ crypto
				.createHash( 'sha1' )
				.update( PROCESS_MANAGER_HOME )
				.digest( 'hex' )
				.slice( 0, 8 ) }`
		: '';
	return `\\\\.\\pipe\\${ name }${ suffix }.sock`;
}

export const PROCESS_MANAGER_CONTROL_SOCKET_PATH =
	process.platform === 'win32'
		? getWindowsPipePath( 'studio-daemon' )
		: path.join( PROCESS_MANAGER_HOME, 'daemon.sock' );
export const PROCESS_MANAGER_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? getWindowsPipePath( 'studio-daemon-events' )
		: path.join( PROCESS_MANAGER_HOME, 'daemon-events.sock' );
