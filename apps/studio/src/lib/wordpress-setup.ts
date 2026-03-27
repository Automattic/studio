/**
 * WordPress site setup utilities.
 * Handles copying WordPress files for offline site creation.
 */

import { pathExists, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { getWordPressVersionPath } from './server-files-paths';

/**
 * Copy bundled WordPress files to a directory.
 * Used when setting up WordPress without full site creation.
 */
export async function setupWordPressFilesOnly( path: string ): Promise< void > {
	const bundledWpPath = getWordPressVersionPath( 'latest' );

	if ( ! ( await pathExists( bundledWpPath ) ) ) {
		throw new Error( 'Bundled WordPress files not found. Please reinstall WordPress Studio.' );
	}

	await recursiveCopyDirectory( bundledWpPath, path );
}
