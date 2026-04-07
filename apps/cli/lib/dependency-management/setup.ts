import fs from 'fs';
import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import semver from 'semver';
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
import { updateLatestSqliteCommandVersion } from './sqlite-command';
import { areDirectoriesDifferentBySizeAndMtime } from './utils';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';
import { updateLatestWpCliVersion } from './wp-cli';

type VersionReader = () => Promise< semver.SemVer | null >;

async function copyBundledDependencyIfNewerOrMissing( {
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

	let bundledVersion: Awaited< ReturnType< VersionReader > >;

	try {
		bundledVersion = await readSourceVersion();
		if ( ! bundledVersion ) {
			return;
		}
	} catch {
		// Do nothing if the bundled version cannot be read
		return;
	}

	try {
		const serverFilesVersion = await readTargetVersion();
		const isBundledVersionNewer =
			serverFilesVersion && semver.gt( bundledVersion, serverFilesVersion );

		if ( ! serverFilesVersion || isBundledVersionNewer ) {
			await recursiveCopyDirectory( sourceDirectoryPath, targetDirectoryPath );
		}
	} catch {
		// Fall back to copying the bundled version if the server files version cannot be read
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
	const bundledSqlitePath = path.join( getWpFilesPath(), SQLITE_FILENAME );
	const installedSqlitePath = getSqlitePluginPath();

	await copyBundledDependencyIfNewerOrMissing( {
		sourceDirectoryPath: bundledSqlitePath,
		targetDirectoryPath: installedSqlitePath,
		readSourceVersion: async () =>
			semver.coerce( await getSqliteVersionFromInstallation( bundledSqlitePath ), {
				includePrerelease: true,
			} ),
		readTargetVersion: async () =>
			semver.coerce( await getSqliteVersionFromInstallation( installedSqlitePath ), {
				includePrerelease: true,
			} ),
	} );
}

async function copyBundledWpCli() {
	const isServerFilesWpCliInstalled = fs.existsSync( getWpCliPharPath() );
	if ( isServerFilesWpCliInstalled ) {
		return;
	}
	const bundledWpCLIPath = path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
	await fs.promises.copyFile( bundledWpCLIPath, getWpCliPharPath() );
}

async function copyBundledSqliteCommand() {
	await copyBundledDependencyIfNewerOrMissing( {
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
	const bundledTranslationsPath = path.join(
		getWpFilesPath(),
		'latest',
		'available-site-translations.json'
	);
	if ( ! fs.existsSync( bundledTranslationsPath ) ) {
		return;
	}
	const installedTranslationsPath = path.join(
		getWordPressVersionPath( 'latest' ),
		'available-site-translations.json'
	);

	await fs.promises.copyFile( bundledTranslationsPath, installedTranslationsPath );
}

async function copyBundledAiInstructions() {
	const bundledAiInstructionsPath = path.join( getWpFilesPath(), 'skills' );
	if ( ! fs.existsSync( bundledAiInstructionsPath ) ) {
		return;
	}

	const isBundledVersionDifferent = await areDirectoriesDifferentBySizeAndMtime(
		bundledAiInstructionsPath,
		getAiInstructionsPath()
	);
	if ( isBundledVersionDifferent ) {
		await recursiveCopyDirectory( bundledAiInstructionsPath, getAiInstructionsPath() );
	}
}

async function copyBundledPhpMyAdmin() {
	await copyBundledDependencyIfNewerOrMissing( {
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
	const bundledLanguagePacksPath = path.join( getWpFilesPath(), 'latest', 'languages' );
	if ( ! fs.existsSync( bundledLanguagePacksPath ) ) {
		return;
	}
	const installedLanguagePacksPath = getLanguagePacksPath();
	await fs.promises.mkdir( installedLanguagePacksPath, { recursive: true } );

	const isBundledVersionDifferent = await areDirectoriesDifferentBySizeAndMtime(
		bundledLanguagePacksPath,
		installedLanguagePacksPath
	);
	if ( isBundledVersionDifferent ) {
		await recursiveCopyDirectory( bundledLanguagePacksPath, installedLanguagePacksPath );
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
