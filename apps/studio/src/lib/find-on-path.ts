import fs from 'fs';
import { posix as posixPath } from 'path';

/**
 * Returns the absolute path of `command` if it's found in any directory on
 * $PATH, or `null` otherwise. Used on Linux to locate editor/CLI binaries
 * regardless of whether they were installed system-wide (e.g. `/usr/bin`),
 * per-user (e.g. `~/.local/bin`), via snap, or via Flatpak wrappers. Uses
 * posix path semantics explicitly so the function behaves identically when
 * unit-tested from Windows or macOS hosts.
 */
export function findOnPath( command: string ): string | null {
	const pathEntries = ( process.env.PATH ?? '' ).split( posixPath.delimiter ).filter( Boolean );

	for ( const dir of pathEntries ) {
		const candidate = posixPath.join( dir, command );
		try {
			const stats = fs.statSync( candidate );
			if ( ! stats.isFile() ) {
				continue;
			}
			fs.accessSync( candidate, fs.constants.X_OK );
			return candidate;
		} catch {
			// Missing, not a regular file (after symlink resolution), or not executable — keep walking.
			continue;
		}
	}

	return null;
}
