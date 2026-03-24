import fs from 'fs';
import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import semver from 'semver';
import { getSqliteVersionFromInstallation } from 'cli/lib/sqlite-integration';
import {
	getAiInstructionsPath,
	getLanguagePacksPath,
	getSqliteCommandPath,
	getSqlitePluginPath,
	getWordPressVersionPath,
	getWpCliPharPath,
	getWpFilesPath,
} from '../server-files';
import { updateLatestSqliteCommandVersion } from './sqlite-command';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';
import { updateLatestWpCliVersion } from './wp-cli';

// Compare the WordPress version in the bundled `wp-files/latest/wordpress` directory (that ships
// with the CLI) to `~/.studio/server-files/wordpress-versions/latest`. If the bundled directory is
// newer, rename the old `wordpress-versions/latest` directory to `wordpress-versions/$VERSION` and
// copy the bundled directory to `wordpress-versions/latest`.
async function copyBundledLatestWpVersion() {
	const bundledWpVersionPath = path.join( getWpFilesPath(), 'latest', 'wordpress' );
	const bundledWpVersion = await getWordPressVersionFromInstallation( bundledWpVersionPath );
	const bundledWpSemver = semver.coerce( bundledWpVersion );

	if ( ! bundledWpVersion || ! bundledWpSemver ) {
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
	const bundledSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( bundledSqlitePath ),
		{ includePrerelease: true }
	);
	if ( ! bundledSqliteVersion ) {
		return;
	}
	const installedSqlitePath = getSqlitePluginPath();
	const isSqliteInstalled = fs.existsSync( installedSqlitePath );
	const installedSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( installedSqlitePath ),
		{ includePrerelease: true }
	);
	const isBundledVersionNewer =
		installedSqliteVersion && semver.gt( bundledSqliteVersion, installedSqliteVersion );
	if ( ! isSqliteInstalled || isBundledVersionNewer ) {
		console.log( `Copying bundled SQLite version ${ bundledSqliteVersion }…` );
		await recursiveCopyDirectory( bundledSqlitePath, getSqlitePluginPath() );
	}
}

async function copyBundledWpCli() {
	const bundledWpCLIInstalled = fs.existsSync( getWpCliPharPath() );
	if ( bundledWpCLIInstalled ) {
		return;
	}
	const bundledWpCLIPath = path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
	await fs.promises.copyFile( bundledWpCLIPath, getWpCliPharPath() );
}

async function copyBundledSqliteCommand() {
	const bundledSqliteCommandPath = path.join( getWpFilesPath(), 'sqlite-command' );
	if ( ! fs.existsSync( bundledSqliteCommandPath ) ) {
		return;
	}
	// Always copy to ensure files are complete and up-to-date
	await recursiveCopyDirectory( bundledSqliteCommandPath, getSqliteCommandPath() );
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
	await recursiveCopyDirectory( bundledAiInstructionsPath, getAiInstructionsPath() );
}

async function copyBundledLanguagePacks() {
	const bundledLanguagePacksPath = path.join( getWpFilesPath(), 'latest', 'languages' );
	if ( ! fs.existsSync( bundledLanguagePacksPath ) ) {
		return;
	}
	const installedLanguagePacksPath = getLanguagePacksPath();
	await fs.promises.mkdir( installedLanguagePacksPath, { recursive: true } );
	await recursiveCopyDirectory( bundledLanguagePacksPath, installedLanguagePacksPath );
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

	for ( const [ name, step ] of steps ) {
		try {
			await step();
		} catch ( error ) {
			console.error( `Failed to upgrade dependency ${ name }:`, error );
		}
	}
}
