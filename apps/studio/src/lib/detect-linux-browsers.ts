import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath } from 'src/lib/find-on-path';

export function isFirefoxInstalledOnLinux( homeDir: string = os.homedir() ): boolean {
	if ( findOnPath( 'firefox' ) !== null ) {
		return true;
	}
	// Snap and Flatpak wrappers don't always land on $PATH for the current
	// shell session, so fall back to the profile / data dirs they create.
	const candidates = [
		path.join( homeDir, '.mozilla', 'firefox' ),
		path.join( homeDir, 'snap', 'firefox' ),
		path.join( homeDir, '.var', 'app', 'org.mozilla.firefox' ),
	];
	return candidates.some( ( dir ) => fs.existsSync( dir ) );
}
