import os from 'node:os';
import path from 'node:path';

/**
 * Where AI sessions live on disk.
 *
 * This is a **temporary stand-in**. The hosted backend ultimately won't read
 * sessions from a local Studio appdata directory at all — sessions will be
 * persisted server-side (git is the leading proposal). For now, so the
 * experimental browser UI can talk to the same sessions the desktop app and CLI
 * already write, we duplicate the CLI's appdata path resolution here rather than
 * depend on CLI internals. `STUDIO_SESSIONS_APPDATA` overrides the base for
 * tests and bespoke setups.
 */
function getAppdataDirectory(): string {
	if ( process.env.STUDIO_SESSIONS_APPDATA ) {
		return process.env.STUDIO_SESSIONS_APPDATA;
	}

	if ( process.platform === 'win32' ) {
		if ( ! process.env.APPDATA ) {
			throw new Error( 'Studio config file path not found.' );
		}
		return path.join( process.env.APPDATA, 'Studio' );
	}

	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio' );
}

export function getAiSessionsRootDirectory(): string {
	return path.join( getAppdataDirectory(), 'sessions' );
}
