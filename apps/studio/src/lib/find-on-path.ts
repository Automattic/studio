import fs from 'fs';
import nodePath from 'path';

/**
 * Returns the absolute path of `command` if it's found in any directory on
 * $PATH, or `null` otherwise. Used on Linux to locate editor/CLI binaries
 * regardless of whether they were installed system-wide (e.g. `/usr/bin`),
 * per-user (e.g. `~/.local/bin`), via snap, or via Flatpak wrappers.
 */
export function findOnPath( command: string ): string | null {
	const pathEntries = ( process.env.PATH ?? '' ).split( nodePath.delimiter ).filter( Boolean );

	for ( const dir of pathEntries ) {
		const candidate = nodePath.join( dir, command );
		if ( fs.existsSync( candidate ) ) {
			return candidate;
		}
	}

	return null;
}
