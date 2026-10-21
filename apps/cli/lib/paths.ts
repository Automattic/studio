import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

export const STUDIO_CLI_HOME = path.join( os.homedir(), '.studio' );

export const PROCESS_MANAGER_HOME =
	process.env.STUDIO_PROCESS_MANAGER_HOME ?? path.join( STUDIO_CLI_HOME, 'daemon' );
export const PROCESS_MANAGER_LOGS_DIR = path.join( PROCESS_MANAGER_HOME, 'logs' );
// Named pipes on Windows share one system-wide namespace, unlike the Unix sockets inside
// PROCESS_MANAGER_HOME. A daemon with its own home (STUDIO_PROCESS_MANAGER_HOME) gets pipe names
// keyed to that home, so it never shares pipes with another daemon. The default home keeps the
// original names, which already-running daemons listen on.
export const WINDOWS_PIPE_PREFIX = process.env.STUDIO_PROCESS_MANAGER_HOME
	? `studio-${ createHash( 'sha256' )
			.update( PROCESS_MANAGER_HOME )
			.digest( 'hex' )
			.slice( 0, 12 ) }-`
	: 'studio-';

export const PROCESS_MANAGER_CONTROL_SOCKET_PATH =
	process.platform === 'win32'
		? `\\\\.\\pipe\\${ WINDOWS_PIPE_PREFIX }daemon.sock`
		: path.join( PROCESS_MANAGER_HOME, 'daemon.sock' );
export const PROCESS_MANAGER_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? `\\\\.\\pipe\\${ WINDOWS_PIPE_PREFIX }daemon-events.sock`
		: path.join( PROCESS_MANAGER_HOME, 'daemon-events.sock' );
