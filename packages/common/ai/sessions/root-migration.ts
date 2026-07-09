import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	LOCKFILE_STALE_TIME,
	LOCKFILE_WAIT_TIME,
	SESSIONS_MIGRATION_LOCKFILE_NAME,
} from '../../constants';
import { lockFileAsync, unlockFileAsync } from '../../lib/lockfile';
import { getConfigDirectory, getSessionsDirectory } from '../../lib/well-known-paths';
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

function sanitizeUserpath( target: string ): string {
	return target.replace( os.homedir(), '~' );
}

function moveFile( from: string, to: string ): void {
	try {
		fs.renameSync( from, to );
	} catch ( error ) {
		// EXDEV: destination sits on a different volume — copy, then remove.
		if ( ( error as NodeJS.ErrnoException ).code !== 'EXDEV' ) {
			throw error;
		}
		fs.copyFileSync( from, to );
		fs.rmSync( from );
	}
}

// Moves every file under `source` into `destination`, preserving structure.
// On a path collision the destination file wins and the source file is left
// behind (session file names embed UUIDs, so collisions mean the file was
// already migrated). Returns the number of files moved.
function mergeDirectoryInto( source: string, destination: string ): number {
	fs.mkdirSync( destination, { recursive: true } );
	let moved = 0;
	for ( const entry of fs.readdirSync( source, { withFileTypes: true } ) ) {
		const from = path.join( source, entry.name );
		const to = path.join( destination, entry.name );
		if ( entry.isDirectory() ) {
			moved += mergeDirectoryInto( from, to );
		} else if ( ! fs.existsSync( to ) ) {
			moveFile( from, to );
			moved += 1;
		}
	}
	try {
		fs.rmdirSync( source );
	} catch {
		// Not empty: a collided file stayed behind for inspection.
	}
	return moved;
}

export function migrateLegacyAiSessionsRoot( newRoot: string, legacyRoots: string[] ): void {
	for ( const legacyRoot of legacyRoots ) {
		if ( ! fs.existsSync( legacyRoot ) ) {
			continue;
		}
		try {
			if ( ! fs.existsSync( newRoot ) ) {
				fs.mkdirSync( path.dirname( newRoot ), { recursive: true } );
				try {
					fs.renameSync( legacyRoot, newRoot );
					console.log(
						`Moved AI sessions from ${ sanitizeUserpath( legacyRoot ) } to ${ sanitizeUserpath(
							newRoot
						) }`
					);
					continue;
				} catch ( error ) {
					if ( ( error as NodeJS.ErrnoException ).code !== 'EXDEV' ) {
						throw error;
					}
					// Different volume: fall through to the per-file merge.
				}
			}
			const moved = mergeDirectoryInto( legacyRoot, newRoot );
			if ( moved > 0 ) {
				console.log(
					`Merged ${ moved } AI session file(s) from ${ sanitizeUserpath(
						legacyRoot
					) } into ${ sanitizeUserpath( newRoot ) }`
				);
			}
		} catch ( error ) {
			// Files stay where they are; needsToRun retries on the next launch.
			console.error(
				`Failed to migrate AI sessions from ${ sanitizeUserpath( legacyRoot ) }:`,
				error
			);
		}
	}
}

// Registered in BOTH the CLI and desktop migration pipelines so it runs for
// CLI-only and desktop-only users alike. needsToRun keys off the legacy
// directories existing at all — so if an out-of-date surface (older desktop
// next to a newer standalone CLI, or vice versa) writes sessions to a legacy
// location after the first migration, the next run of any up-to-date surface
// sweeps the stragglers in. The lockfile serializes concurrent runs.
export const moveAiSessionsToStudioDir: Migration = {
	async needsToRun() {
		// E2E/dev sandboxes resolve the sessions root inside the sandbox while
		// the legacy candidates point at the real user's sessions — never migrate.
		if ( process.env.E2E || process.env.DEV_CONFIG_DIR ) {
			return false;
		}
		return getLegacyAiSessionsRootDirectories().some( ( dir ) => fs.existsSync( dir ) );
	},
	async run() {
		const lockPath = path.join( getConfigDirectory(), SESSIONS_MIGRATION_LOCKFILE_NAME );
		fs.mkdirSync( path.dirname( lockPath ), { recursive: true } );
		await lockFileAsync( lockPath, {
			wait: LOCKFILE_WAIT_TIME,
			stale: LOCKFILE_STALE_TIME,
		} );
		try {
			migrateLegacyAiSessionsRoot( getSessionsDirectory(), getLegacyAiSessionsRootDirectories() );
		} finally {
			await unlockFileAsync( lockPath );
		}
	},
};
