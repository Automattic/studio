import path from 'path';

/**
 * Core storage paths interface for both Electron app and CLI
 */
export interface StoragePaths {
	/**
	 * Platform-specific base app data directory
	 * @returns ~/Library/Application Support (macOS) or %APPDATA% (Windows)
	 */
	getAppDataPath(): string;

	/**
	 * Studio-specific data directory
	 * @returns ~/Library/Application Support/Studio
	 */
	getStudioDataPath(): string;

	/**
	 * Bundled resources directory (WordPress files, SQLite, etc.)
	 * @returns Platform-specific path to bundled resources
	 */
	getResourcesPath(): string;

	/**
	 * Server files directory for downloaded/cached components
	 * @returns ~/Library/Application Support/Studio/server-files
	 */
	getServerFilesPath(): string;
}

/**
 * Create storage paths abstraction for cross-platform usage
 *
 * @param appDataPath Platform-specific base app data path
 * @param appName Application name (usually 'Studio')
 * @param resourcesPath Platform-specific resources path
 * @returns StoragePaths interface
 */
export function createStoragePaths(
	appDataPath: string,
	appName: string,
	resourcesPath: string
): StoragePaths {
	const studioDataPath = path.join( appDataPath, appName );

	return {
		getAppDataPath: () => appDataPath,
		getStudioDataPath: () => studioDataPath,
		getResourcesPath: () => resourcesPath,
		getServerFilesPath: () => path.join( studioDataPath, 'server-files' ),
	};
}
