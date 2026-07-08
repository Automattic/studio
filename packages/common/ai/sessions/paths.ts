import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSessionsDirectory } from '../../lib/well-known-paths';

function formatDatePart( value: number ): string {
	return String( value ).padStart( 2, '0' );
}

// Bucket sessions by local calendar date: <rootDirectory>/<YYYY>/<MM>/<DD>.
export function getAiSessionsDirectoryForDate( rootDirectory: string, date: Date ): string {
	const year = String( date.getFullYear() );
	const month = formatDatePart( date.getMonth() + 1 );
	const day = formatDatePart( date.getDate() );
	return path.join( rootDirectory, year, month, day );
}

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

let legacyRootMigrationChecked = false;

export function getAiSessionsRootDirectory(): string {
	const root = getSessionsDirectory();
	// Lazy one-time migration so it runs for desktop-only AND CLI-only users —
	// every surface resolves the root through here before touching the directory.
	if ( ! legacyRootMigrationChecked ) {
		legacyRootMigrationChecked = true;
		// Skip under E2E/dev sandboxes: the legacy candidates would point at the
		// real user's sessions and migration would pull them into the sandbox.
		if ( ! process.env.E2E && ! process.env.DEV_CONFIG_DIR ) {
			migrateLegacyAiSessionsRoot( root, getLegacyAiSessionsRootDirectories() );
		}
	}
	return root;
}
