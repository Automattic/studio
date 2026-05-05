import { cp, mkdir, readFile, rm } from 'fs/promises';
import path from 'path';

const PLUGIN_DIR_NAME = 'studio-panels';

// Bundled by `viteStaticCopy` (see vite.config.dev/prod/npm) as a sibling of
// the CLI modules in dist/.
const BUNDLED_PLUGIN_DIR = path.resolve( import.meta.dirname, PLUGIN_DIR_NAME );

interface InstallResult {
	installed: boolean;
	previousVersion: string | null;
	currentVersion: string;
}

async function readVersion( versionFile: string ): Promise< string | null > {
	try {
		const contents = await readFile( versionFile, 'utf8' );
		return contents.trim() || null;
	} catch {
		return null;
	}
}

// `sourceDir` defaults to the bundled CLI dist; `studio-panels-builder` passes
// the monorepo source root for the on-the-fly path.
export async function ensureStudioPanelsInstalled(
	sitePath: string,
	sourceDir: string = BUNDLED_PLUGIN_DIR
): Promise< InstallResult > {
	const targetDir = path.join( sitePath, 'wp-content', 'plugins', PLUGIN_DIR_NAME );
	const currentVersion = await readVersion( path.join( sourceDir, 'version.txt' ) );

	if ( ! currentVersion ) {
		throw new Error(
			`Studio Panels plugin missing version.txt at ${ sourceDir }. Did the build complete?`
		);
	}

	const previousVersion = await readVersion( path.join( targetDir, 'version.txt' ) );
	if ( previousVersion === currentVersion ) {
		return { installed: false, previousVersion, currentVersion };
	}

	// Replace wholesale so removed routes from a previous version don't linger.
	await rm( targetDir, { recursive: true, force: true } );
	await mkdir( path.dirname( targetDir ), { recursive: true } );
	await cp( sourceDir, targetDir, { recursive: true } );

	return { installed: true, previousVersion, currentVersion };
}
