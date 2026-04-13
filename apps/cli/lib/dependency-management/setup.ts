import fs from 'fs';
import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import semver from 'semver';
import {
	getAiInstructionsPath,
	getLanguagePacksPath,
	getPhpMyAdminPath,
	getSqliteCommandPath,
	getWordPressVersionPath,
	getWpCliPharPath,
	getWpFilesPath,
} from '../server-files';
import { updateLatestSqliteCommandVersion } from './sqlite-command';
import { areDirectoriesDifferentBySizeAndMtime } from './utils';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';
import { updateLatestWpCliVersion } from './wp-cli';

type VersionReader = () => Promise< semver.SemVer | null >;

async function copySourceDirectoryIfNewerOrMissing( {
	sourceDirectoryPath,
	targetDirectoryPath,
	readSourceVersion,
	readTargetVersion,
}: {
	sourceDirectoryPath: string;
	targetDirectoryPath: string;
	readSourceVersion: VersionReader;
	readTargetVersion: VersionReader;
} ) {
	if ( ! fs.existsSync( sourceDirectoryPath ) ) {
		return;
	}

	let sourceVersion: Awaited< ReturnType< VersionReader > >;
	let shouldCopy = false;

	try {
		sourceVersion = await readSourceVersion();
		if ( ! sourceVersion ) {
			return;
		}
	} catch {
		// Do nothing if the source version cannot be read
		return;
	}

	try {
		const targetVersion = await readTargetVersion();
		const isSourceVersionNewer = targetVersion && semver.gt( sourceVersion, targetVersion );
		shouldCopy = Boolean( ! targetVersion || isSourceVersionNewer );
	} catch {
		// The error is likely because of a missing or corrupted target directory, in which case we
		// copy the source directory to the target directory
		shouldCopy = true;
	}

	if ( shouldCopy ) {
		try {
			await fs.promises.rm( targetDirectoryPath, { recursive: true, force: true } );
		} catch {
			// Do nothing if the target directory is missing or corrupted
		}
		await recursiveCopyDirectory( sourceDirectoryPath, targetDirectoryPath );
	}
}

// Compare the WordPress version in the bundled `wp-files/latest/wordpress` directory (that ships
// with the CLI) to `~/.studio/server-files/wordpress-versions/latest`. If the bundled directory is
// newer, rename the old `wordpress-versions/latest` directory to `wordpress-versions/$VERSION` and
// copy the bundled directory to `wordpress-versions/latest`.
async function copyBundledLatestWpVersion() {
	const bundledWpVersionPath = path.join( getWpFilesPath(), 'latest', 'wordpress' );
	const bundledWpVersion = await getWordPressVersionFromInstallation( bundledWpVersionPath );
	const bundledWpSemver = semver.coerce( bundledWpVersion );

	if ( ! bundledWpSemver ) {
		return;
	}

	const latestWpVersionPath = getWordPressVersionPath( 'latest' );
	const latestWpVersion = await getWordPressVersionFromInstallation( latestWpVersionPath );
	const latestWpSemver = semver.coerce( latestWpVersion );

	if ( ! latestWpVersion || ! latestWpSemver ) {
		await recursiveCopyDirectory( bundledWpVersionPath, latestWpVersionPath );
	} else if ( semver.gt( bundledWpSemver, latestWpSemver ) ) {
		try {
			await fs.promises.rename( latestWpVersionPath, getWordPressVersionPath( latestWpVersion ) );
		} catch {
			// Assume the target directory already exists. Do nothing
		}
		await recursiveCopyDirectory( bundledWpVersionPath, latestWpVersionPath );
	}
}

async function copyBundledWpCli() {
	const sourceWpCLIPath = path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
	const sourceStats = await fs.promises.lstat( sourceWpCLIPath );
	let shouldCopy = false;

	try {
		const targetStats = await fs.promises.lstat( getWpCliPharPath() );
		shouldCopy =
			sourceStats.size !== targetStats.size ||
			Math.floor( sourceStats.mtimeMs ) !== Math.floor( targetStats.mtimeMs );
	} catch {
		shouldCopy = true;
	}

	if ( shouldCopy ) {
		await fs.promises.cp( sourceWpCLIPath, getWpCliPharPath(), {
			mode: fs.constants.COPYFILE_FICLONE,
			preserveTimestamps: true,
		} );
	}
}

async function patchSqliteCommandForStudio() {
	// Patch the installed SQLiteDatabaseIntegrationLoader.php to also check
	// Playground's in-memory VFS path for the SQLite integration plugin.
	// Playground CLI mounts the plugin at /internal/shared/sqlite-database-integration
	// inside its virtual filesystem, so it is never written to the site directory on disk.
	// This patch is applied after copying the bundled sqlite-command to the server-files
	// directory. The upstream sqlite-command repo will be updated separately.
	const loaderPath = path.join(
		getSqliteCommandPath(),
		'src',
		'SQLiteDatabaseIntegrationLoader.php'
	);

	if ( ! fs.existsSync( loaderPath ) ) {
		return;
	}

	let content = await fs.promises.readFile( loaderPath, 'utf8' );
	let modified = false;

	// 1. Add /internal/shared/ path to get_plugin_directory() if not already present.
	// Playground CLI mounts the SQLite plugin at this in-memory VFS path, so it is
	// never written to the site directory on disk.
	const internalSharedPath = '/internal/shared/sqlite-database-integration';
	const muPluginsLine = "\t\t\tABSPATH . '/wp-content/mu-plugins/sqlite-database-integration',";
	if ( ! content.includes( internalSharedPath ) && content.includes( muPluginsLine ) ) {
		content = content.replace(
			muPluginsLine,
			muPluginsLine + `\n\t\t\t'${ internalSharedPath }',`
		);
		modified = true;
	}

	// 2. Replace get_plugin_version() with a simpler implementation that reads the version
	// directly from wp-includes/database/version.php (which defines SQLITE_DRIVER_VERSION).
	// The original implementation requires db.php on disk, which Playground never writes.
	const originalGetPluginVersionMethod =
		'\tpublic static function get_plugin_version() {\n' +
		'\t\t// Check if there is a db.php file in the wp-content directory.\n' +
		"\t\tif ( ! file_exists( ABSPATH . '/wp-content/db.php' ) ) {\n" +
		'\t\t\treturn false;\n' +
		'\t\t}\n' +
		'\n' +
		'\t\t// If the file is found, we need to check that it is the sqlite integration plugin.\n' +
		"\t\t$plugin_file = file_get_contents( ABSPATH . '/wp-content/db.php' );\n" +
		"\t\tif ( ! preg_match( '/define\\( \\'SQLITE_DB_DROPIN_VERSION\\', \\'([0-9.]+)\\' \\)/', $plugin_file ) ) {\n" +
		'\t\t\treturn false;\n' +
		'\t\t}\n' +
		'\n' +
		'\t\t$plugin_path = self::get_plugin_directory();\n' +
		'\t\tif ( ! $plugin_path ) {\n' +
		'\t\t\treturn false;\n' +
		'\t\t}\n' +
		'\n' +
		'\t\t// Try to get the version number from readme.txt\n' +
		"\t\t$plugin_file = file_get_contents( $plugin_path . '/readme.txt' );\n" +
		'\n' +
		"\t\tpreg_match( '/^Stable tag:\\s*?(.+)$/m', $plugin_file, $matches );\n" +
		'\n' +
		'\t\treturn isset( $matches[1] ) ? trim( $matches[1] ) : false;\n' +
		'\t}';

	const patchedGetPluginVersionMethod =
		'\tpublic static function get_plugin_version() {\n' +
		'\t\t$plugin_path = self::get_plugin_directory();\n' +
		'\t\tif ( ! $plugin_path ) {\n' +
		'\t\t\treturn false;\n' +
		'\t\t}\n' +
		'\n' +
		"\t\t$version_file = $plugin_path . '/wp-includes/database/version.php';\n" +
		'\t\tif ( ! file_exists( $version_file ) ) {\n' +
		'\t\t\treturn false;\n' +
		'\t\t}\n' +
		'\n' +
		'\t\trequire_once $version_file;\n' +
		'\n' +
		"\t\treturn defined( 'SQLITE_DRIVER_VERSION' ) ? SQLITE_DRIVER_VERSION : false;\n" +
		'\t}';

	if ( content.includes( originalGetPluginVersionMethod ) ) {
		content = content.replace( originalGetPluginVersionMethod, patchedGetPluginVersionMethod );
		modified = true;
	}

	if ( modified ) {
		await fs.promises.writeFile( loaderPath, content, 'utf8' );
	}
}

async function copyBundledSqliteCommand() {
	await copySourceDirectoryIfNewerOrMissing( {
		sourceDirectoryPath: path.join( getWpFilesPath(), 'sqlite-command' ),
		targetDirectoryPath: getSqliteCommandPath(),
		readSourceVersion: async () => {
			const versionFilePath = path.join( getWpFilesPath(), 'sqlite-command', 'version' );
			return semver.coerce( fs.readFileSync( versionFilePath, 'utf8' ) );
		},
		readTargetVersion: async () => {
			const versionFilePath = path.join( getSqliteCommandPath(), 'version' );
			return semver.coerce( fs.readFileSync( versionFilePath, 'utf8' ) );
		},
	} );
	await patchSqliteCommandForStudio();
}

async function copyBundledTranslations() {
	const sourceTranslationsPath = path.join(
		getWpFilesPath(),
		'latest',
		'available-site-translations.json'
	);
	const targetTranslationsPath = path.join(
		getWordPressVersionPath( 'latest' ),
		'available-site-translations.json'
	);

	const sourceStats = await fs.promises.lstat( sourceTranslationsPath );
	let shouldCopy = false;

	try {
		const targetStats = await fs.promises.lstat( targetTranslationsPath );
		shouldCopy =
			sourceStats.size !== targetStats.size ||
			Math.floor( sourceStats.mtimeMs ) !== Math.floor( targetStats.mtimeMs );
	} catch {
		shouldCopy = true;
	}

	if ( shouldCopy ) {
		await fs.promises.cp( sourceTranslationsPath, targetTranslationsPath, {
			mode: fs.constants.COPYFILE_FICLONE,
			preserveTimestamps: true,
		} );
	}
}

async function copyBundledAiInstructions() {
	const sourceAiInstructionsPath = path.join( getWpFilesPath(), 'skills' );
	if ( ! fs.existsSync( sourceAiInstructionsPath ) ) {
		return;
	}

	const isSourceDirectoryDifferent = await areDirectoriesDifferentBySizeAndMtime(
		sourceAiInstructionsPath,
		getAiInstructionsPath()
	);
	if ( isSourceDirectoryDifferent ) {
		try {
			await fs.promises.rm( getAiInstructionsPath(), { recursive: true, force: true } );
		} catch {
			// Do nothing if the target directory is missing or corrupted
		}
		await recursiveCopyDirectory( sourceAiInstructionsPath, getAiInstructionsPath() );
	}
}

async function copyBundledPhpMyAdmin() {
	await copySourceDirectoryIfNewerOrMissing( {
		sourceDirectoryPath: path.join( getWpFilesPath(), 'phpmyadmin' ),
		targetDirectoryPath: getPhpMyAdminPath(),
		readSourceVersion: async () => {
			const composerFilePath = path.join( getWpFilesPath(), 'phpmyadmin', 'composer.json' );
			const composerFile = JSON.parse( fs.readFileSync( composerFilePath, 'utf8' ) );
			return semver.coerce( composerFile.version );
		},
		readTargetVersion: async () => {
			const composerFilePath = path.join( getPhpMyAdminPath(), 'composer.json' );
			const composerFile = JSON.parse( fs.readFileSync( composerFilePath, 'utf8' ) );
			return semver.coerce( composerFile.version );
		},
	} );
}

async function copyBundledLanguagePacks() {
	const sourceLanguagePacksPath = path.join( getWpFilesPath(), 'latest', 'languages' );
	if ( ! fs.existsSync( sourceLanguagePacksPath ) ) {
		return;
	}
	const targetLanguagePacksPath = getLanguagePacksPath();
	const isSourceDirectoryDifferent = await areDirectoriesDifferentBySizeAndMtime(
		sourceLanguagePacksPath,
		targetLanguagePacksPath
	);
	if ( isSourceDirectoryDifferent ) {
		try {
			await fs.promises.rm( targetLanguagePacksPath, { recursive: true, force: true } );
		} catch {
			// Do nothing if the target directory is missing or corrupted
		}
		await recursiveCopyDirectory( sourceLanguagePacksPath, targetLanguagePacksPath );
	}
}

export async function setupServerFiles() {
	const steps: [ string, () => Promise< void > ][] = [
		[ 'WordPress version', copyBundledLatestWpVersion ],
		[ 'WP-CLI', copyBundledWpCli ],
		[ 'SQLite command', copyBundledSqliteCommand ],
		[ 'translations', copyBundledTranslations ],
		[ 'language packs', copyBundledLanguagePacks ],
		[ 'AI instructions', copyBundledAiInstructions ],
		[ 'phpMyAdmin', copyBundledPhpMyAdmin ],
	];

	for ( const [ name, step ] of steps ) {
		try {
			await step();
		} catch ( error ) {
			console.error( `Failed to set up dependency ${ name }:`, error );
		}
	}
}

export async function updateServerFiles() {
	const steps: [ string, () => Promise< void > ][] = [
		[ 'WordPress version', updateLatestWordPressVersion ],
		[ 'WP-CLI', updateLatestWpCliVersion ],
		[ 'SQLite integration', updateLatestSqliteCommandVersion ],
	];

	await Promise.all(
		steps.map( ( [ name, step ] ) =>
			step().catch( ( error ) => {
				console.error( `Failed to update dependency ${ name }:`, error );
			} )
		)
	);
}
