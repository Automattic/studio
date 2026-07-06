import os from 'os';
import path from 'path';

export const STUDIO_CLI_HOME = path.join( os.homedir(), '.studio' );

export const PROCESS_MANAGER_HOME =
	process.env.STUDIO_PROCESS_MANAGER_HOME ?? path.join( STUDIO_CLI_HOME, 'daemon' );
export const PROCESS_MANAGER_LOGS_DIR = path.join( PROCESS_MANAGER_HOME, 'logs' );
export const PROCESS_MANAGER_CONTROL_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\studio-daemon.sock'
		: path.join( PROCESS_MANAGER_HOME, 'daemon.sock' );
export const PROCESS_MANAGER_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\studio-daemon-events.sock'
		: path.join( PROCESS_MANAGER_HOME, 'daemon-events.sock' );
