import fs from 'fs';
import path from 'path';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';

/**
 * Whether a pull can leave WordPress core out and keep the site's own: the site has core of its
 * own, not links into a pulled tree, at the version the remote runs. Reprint refuses to keep linked
 * core, so a site flattened with links pulls core once and gets a copy.
 */
export function canKeepOwnCore( sitePath: string, remoteWpVersion: string | null ): boolean {
	const wpIncludes = fs.lstatSync( path.join( sitePath, 'wp-includes' ), {
		throwIfNoEntry: false,
	} );
	return (
		!! remoteWpVersion &&
		!! wpIncludes?.isDirectory() &&
		getWordPressVersion( sitePath ) === remoteWpVersion
	);
}
