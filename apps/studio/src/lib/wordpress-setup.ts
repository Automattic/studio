/**
 * WordPress site setup utilities.
 * Handles copying WordPress files for offline site creation.
 */

import nodePath from 'path';
import { pathExists, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { getResourcesPath } from 'src/storage/paths';

/**
 * Copy bundled WordPress files to a directory.
 * Used when setting up WordPress without full site creation.
 */
export async function setupWordPressFilesOnly( path: string ): Promise< void > {
	const bundledWPPath = nodePath.join( getResourcesPath(), 'wp-files', 'latest', 'wordpress' );

	if ( ! ( await pathExists( bundledWPPath ) ) ) {
		throw new Error( 'Bundled WordPress files not found. Please reinstall WordPress Studio.' );
	}

	await recursiveCopyDirectory( bundledWPPath, path );
}
