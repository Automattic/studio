import path from 'path';
import fs from 'fs-extra';
import { recursiveCopyDirectory, pathExists } from './fs-utils';
import { isOnline } from './network-utils';
import { setupSqliteDatabase } from './sqlite-setup';
import {
	getWordPressVersionPath,
	isWordPressVersionCached,
	downloadWordPressVersion,
} from './wordpress-version-manager';
import { isValidWordPressVersion } from './wordpress-version-utils';

export interface WordPressSetupOptions {
	/** Path to the site directory where WordPress should be installed */
	sitePath: string;
	/** WordPress version to install ('latest' or specific version) */
	wpVersion?: string;
	/** Path to server files directory containing WordPress resources */
	serverFilesPath: string;
}

/**
 * Set up WordPress files in a directory with SQLite integration
 *
 * This is the core WordPress setup function that:
 * 1. Downloads/caches specific WordPress versions when online
 * 2. Falls back to bundled latest version when offline
 * 3. Copies WordPress files from appropriate source to the site directory
 * 4. Installs SQLite database integration if no wp-config.php exists
 *
 * @param options WordPress setup configuration
 * @returns Promise<boolean> - true if setup completed successfully
 */
export async function setupWordPressSite( options: WordPressSetupOptions ): Promise< boolean > {
	const { sitePath, wpVersion = 'latest', serverFilesPath } = options;

	try {
		const isOnlineStatus = await isOnline();

		if ( ! isValidWordPressVersion( wpVersion ) ) {
			throw new Error(
				`Invalid WordPress version '${ wpVersion }'. ` +
					'Please use "latest" or valid version like "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
			);
		}

		if (
			isOnlineStatus &&
			wpVersion !== 'latest' &&
			! ( await isWordPressVersionCached( wpVersion, serverFilesPath ) )
		) {
			console.log( `Downloading WordPress version ${ wpVersion }...` );
			await downloadWordPressVersion( wpVersion, serverFilesPath );
		}
		const sourceWpPath = getWordPressVersionPath( wpVersion, serverFilesPath );
		if ( ! ( await pathExists( sourceWpPath ) ) ) {
			throw new Error(
				'Cannot set up WordPress while offline. WordPress files not found in server files. ' +
					'Please connect to the internet to download WordPress resources.'
			);
		}

		// Copy WordPress files from source to site directory
		try {
			await recursiveCopyDirectory( sourceWpPath, sitePath );
		} catch ( error ) {
			throw new Error(
				'Failed to copy WordPress files for setup. Please check directory permissions.'
			);
		}

		// Set up SQLite database integration if no wp-config.php exists
		const wpConfigPath = path.join( sitePath, 'wp-config.php' );
		if ( ! ( await fs.pathExists( wpConfigPath ) ) ) {
			await setupSqliteDatabase( sitePath, serverFilesPath );
		}

		return true;
	} catch ( error ) {
		console.error( 'Failed to setup WordPress site:', error );
		throw error;
	}
}
