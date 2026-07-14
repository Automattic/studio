import path from 'node:path';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';

/**
 * Where AI sessions live on disk.
 *
 * This is a **temporary stand-in**. The hosted backend ultimately won't read
 * sessions from a local Studio directory at all — sessions will be persisted
 * server-side (git is the leading proposal). For now, so the experimental
 * browser UI can talk to the same sessions the desktop app and CLI already
 * write, we resolve the same `~/.studio/sessions` root they use.
 * `STUDIO_SESSIONS_APPDATA` overrides the base for tests and bespoke setups.
 */
export function getAiSessionsRootDirectory(): string {
	if ( process.env.STUDIO_SESSIONS_APPDATA ) {
		return path.join( process.env.STUDIO_SESSIONS_APPDATA, 'sessions' );
	}
	return getSessionsDirectory();
}
