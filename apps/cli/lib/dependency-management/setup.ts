import fs from 'fs';
import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import semver from 'semver';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { getSqliteVersionFromInstallation } from 'cli/lib/sqlite-integration';
import {
	getAiInstructionsPath,
	getLanguagePacksPath,
	getPhpMyAdminPath,
	getSqliteCommandPath,
	getSqlitePluginPath,
	getWordPressVersionPath,
	getWpCliPharPath,
	getWpFilesPath,
} from '../server-files';
import { areDirectoriesDifferentBySizeAndMtime } from './utils';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';

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

const SQLITE_FILENAME = 'sqlite-database-integration';

async function copyBundledSqlite() {
	const sourceSqlitePath = path.join( getWpFilesPath(), SQLITE_FILENAME );
	const targetSqlitePath = getSqlitePluginPath();

	await copySourceDirectoryIfNewerOrMissing( {
		sourceDirectoryPath: sourceSqlitePath,
		targetDirectoryPath: targetSqlitePath,
		readSourceVersion: async () =>
			semver.coerce( await getSqliteVersionFromInstallation( sourceSqlitePath ), {
				includePrerelease: true,
			} ),
		readTargetVersion: async () =>
			semver.coerce( await getSqliteVersionFromInstallation( targetSqlitePath ), {
				includePrerelease: true,
			} ),
	} );
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
		[ 'SQLite integration', copyBundledSqlite ],
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

/**
 * Fetches the latest WordPress version from the network.
 *
 * This performs a network request, so callers should gate it behind
 * `shouldCheckDependencyUpdates()` and follow a successful call with
 * `markDependencyCheckTime()` to avoid hitting the network on every
 * invocation (see STU-1455).
 */
export async function updateServerFiles() {
	try {
		await updateLatestWordPressVersion();
	} catch ( error ) {
		console.error( 'Failed to update dependency WordPress version:', error );
	}
}

export const DEPENDENCY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function shouldCheckDependencyUpdates(): Promise< boolean > {
	try {
		const { lastDependencyCheckTime } = await readCliConfig();
		if ( typeof lastDependencyCheckTime !== 'number' ) {
			return true;
		}
		const now = Date.now();
		// Treat future timestamps (clock skew) as stale.
		if ( lastDependencyCheckTime > now ) {
			return true;
		}
		return now - lastDependencyCheckTime >= DEPENDENCY_CHECK_INTERVAL_MS;
	} catch {
		return true;
	}
}

export async function markDependencyCheckTime(): Promise< void > {
	try {
		await updateCliConfigWithPartial( { lastDependencyCheckTime: Date.now() } );
	} catch ( error ) {
		console.error( 'Failed to persist dependency check timestamp:', error );
	}
}
