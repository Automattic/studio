import fs from 'fs';
import path from 'path';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';

/**
 * Whether the pull can skip WordPress core because the site already runs the remote's version.
 * The site's core must be real files, not symlinks into the pull folder. A core copy that stopped
 * partway still reports the previous version, because Reprint copies version.php last.
 */
export function canKeepOwnCore( sitePath: string, remoteWpVersion: string | null ): boolean {
	if ( ! remoteWpVersion ) {
		return false;
	}
	const wpIncludes = fs.lstatSync( path.join( sitePath, 'wp-includes' ), {
		throwIfNoEntry: false,
	} );
	return !! wpIncludes?.isDirectory() && getWordPressVersion( sitePath ) === remoteWpVersion;
}
