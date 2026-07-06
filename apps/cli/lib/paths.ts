import os from 'os';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

export const STUDIO_CLI_HOME = path.join( os.homedir(), '.studio' );

// The daemon home must live inside the same config directory the rest of the
// CLI reads from, so a DEV_CONFIG_DIR sandbox (e.g. the MySQL POC or
// `start:test`) redirects the daemon socket alongside cli.json/shared.json.
// Without this, a sandboxed CLI would connect to the default ~/.studio daemon
// and drive real sites through it. getConfigDirectory() returns ~/.studio when
// DEV_CONFIG_DIR is unset, so normal installs are unaffected. An explicit
// STUDIO_PROCESS_MANAGER_HOME still takes precedence for anyone pinning it.
export const PROCESS_MANAGER_HOME =
	process.env.STUDIO_PROCESS_MANAGER_HOME ?? path.join( getConfigDirectory(), 'daemon' );
export const PROCESS_MANAGER_LOGS_DIR = path.join( PROCESS_MANAGER_HOME, 'logs' );
export const PROCESS_MANAGER_CONTROL_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\studio-daemon.sock'
		: path.join( PROCESS_MANAGER_HOME, 'daemon.sock' );
export const PROCESS_MANAGER_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\studio-daemon-events.sock'
		: path.join( PROCESS_MANAGER_HOME, 'daemon-events.sock' );
