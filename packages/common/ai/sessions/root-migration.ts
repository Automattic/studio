import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSessionsDirectory } from '../../lib/well-known-paths';
import type { Migration } from '../../lib/migration';

// Pre-move sessions locations: the CLI hardcoded <platform appdata>/Studio/sessions
// (the macOS path on every non-Windows platform), the desktop used Electron's
// userData, which matches except on Linux (~/.config/Studio).
function getLegacyAiSessionsRootDirectories(): string[] {
	if ( process.platform === 'win32' ) {
		return process.env.APPDATA ? [ path.join( process.env.APPDATA, 'Studio', 'sessions' ) ] : [];
	}
	const roots = [
		path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'sessions' ),
	];
	if ( process.platform === 'linux' ) {
		roots.push(
			path.join(
				process.env.XDG_CONFIG_HOME || path.join( os.homedir(), '.config' ),
				'Studio',
				'sessions'
			)
		);
	}
	return roots;
}

export function migrateLegacyAiSessionsRoot( newRoot: string, legacyRoots: string[] ): void {
	if ( fs.existsSync( newRoot ) ) {
		return;
	}
	const legacyRoot = legacyRoots.find( ( dir ) => fs.existsSync( dir ) );
	if ( ! legacyRoot ) {
		return;
	}
	fs.mkdirSync( path.dirname( newRoot ), { recursive: true } );
	try {
		fs.renameSync( legacyRoot, newRoot );
	} catch ( error ) {
		// ENOENT/ENOTEMPTY: a concurrent CLI/desktop first run won the rename —
		// the sessions are already at newRoot. EXDEV: ~/.studio sits on a
		// different volume; copy instead and keep the original as a backup.
		if ( ( error as NodeJS.ErrnoException ).code !== 'EXDEV' ) {
			return;
		}
		fs.cpSync( legacyRoot, newRoot, { recursive: true } );
		try {
			fs.renameSync( legacyRoot, `${ legacyRoot }.migrated` );
		} catch {
			// Another process already renamed it.
		}
	}
}

// Registered in BOTH the CLI and desktop migration pipelines so it runs for
// CLI-only and desktop-only users alike. A concurrent desktop + CLI first run
// is safe without a lockfile: the rename is atomic and the loser's failure is
// swallowed above.
export const moveAiSessionsToStudioDir: Migration = {
	async needsToRun() {
		// E2E/dev sandboxes resolve the sessions root inside the sandbox while
		// the legacy candidates point at the real user's sessions — never migrate.
		if ( process.env.E2E || process.env.DEV_CONFIG_DIR ) {
			return false;
		}
		if ( fs.existsSync( getSessionsDirectory() ) ) {
			return false;
		}
		return getLegacyAiSessionsRootDirectories().some( ( dir ) => fs.existsSync( dir ) );
	},
	async run() {
		migrateLegacyAiSessionsRoot( getSessionsDirectory(), getLegacyAiSessionsRootDirectories() );
	},
};
