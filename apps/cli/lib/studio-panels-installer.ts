import { cp, mkdir, readFile, rm, stat } from 'fs/promises';
import path from 'path';

const PLUGIN_DIR_NAME = 'studio-panels';

/**
 * Path to the bundled Studio Panels plugin in the CLI's `dist/` output.
 * Set during the CLI build by `viteStaticCopy` (see vite.config.dev/prod/npm),
 * which writes it as a sibling of the bundled CLI modules.
 */
const BUNDLED_PLUGIN_DIR = path.resolve( import.meta.dirname, PLUGIN_DIR_NAME );

interface InstallResult {
	installed: boolean;
	previousVersion: string | null;
	currentVersion: string;
	pluginDir: string;
}

async function pathExists( target: string ): Promise< boolean > {
	try {
		await stat( target );
		return true;
	} catch {
		return false;
	}
}

async function readVersion( versionFile: string ): Promise< string | null > {
	try {
		const contents = await readFile( versionFile, 'utf8' );
		return contents.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Returns the path to the bundled plugin sources within the CLI's dist tree.
 * Exported for tests; production code should not rely on this.
 */
export function getBundledPluginDir(): string {
	return BUNDLED_PLUGIN_DIR;
}

/**
 * Returns where the plugin is/will be installed inside a given site.
 */
export function getInstalledPluginDir( sitePath: string ): string {
	return path.join( sitePath, 'wp-content', 'plugins', PLUGIN_DIR_NAME );
}

/**
 * Ensure the Studio Panels plugin is installed at the bundled version inside
 * the given site. If the installed version differs (or is missing), copies the
 * bundled plugin in place.
 *
 * Returns metadata describing whether a copy actually happened.
 *
 * @param sitePath        Absolute path to the local Studio site root.
 * @param bundledPluginDir Override the source of the bundled plugin (tests).
 */
export async function ensureStudioPanelsInstalled(
	sitePath: string,
	bundledPluginDir: string = BUNDLED_PLUGIN_DIR
): Promise< InstallResult > {
	const targetDir = getInstalledPluginDir( sitePath );
	const bundledVersionFile = path.join( bundledPluginDir, 'version.txt' );
	const currentVersion = await readVersion( bundledVersionFile );

	if ( ! currentVersion ) {
		throw new Error(
			`Bundled Studio Panels plugin is missing version.txt at ${ bundledVersionFile }. ` +
				`Did the CLI build complete?`
		);
	}

	if ( ! ( await pathExists( bundledPluginDir ) ) ) {
		throw new Error(
			`Bundled Studio Panels plugin not found at ${ bundledPluginDir }. ` +
				`Did the CLI build complete?`
		);
	}

	const installedVersionFile = path.join( targetDir, 'version.txt' );
	const previousVersion = await readVersion( installedVersionFile );

	if ( previousVersion === currentVersion ) {
		return { installed: false, previousVersion, currentVersion, pluginDir: targetDir };
	}

	// Replace the directory entirely to avoid stale files (e.g. removed routes
	// from a previous version). `rm` is a no-op if the dir doesn't exist.
	await rm( targetDir, { recursive: true, force: true } );
	await mkdir( path.dirname( targetDir ), { recursive: true } );
	await cp( bundledPluginDir, targetDir, { recursive: true } );

	return { installed: true, previousVersion, currentVersion, pluginDir: targetDir };
}
