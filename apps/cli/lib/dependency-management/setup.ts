import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import fs from 'fs-extra';
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

async function copyBundledLatestWPVersion() {
	const bundledWPVersionPath = path.join( getWpFilesPath(), 'latest', 'wordpress' );
	const bundledWPVersion = semver.coerce(
		await getWordPressVersionFromInstallation( bundledWPVersionPath )
	);
	if ( ! bundledWPVersion ) {
		return;
	}
	const latestWPVersionPath = getWordPressVersionPath( 'latest' );
	const latestWPVersion = await getWordPressVersionFromInstallation( latestWPVersionPath );
	const latestWPSemVersion = semver.coerce( latestWPVersion );
	const isBundledVersionNewer =
		latestWPVersion && latestWPSemVersion && semver.gt( bundledWPVersion, latestWPSemVersion );
	if ( ! latestWPVersion || isBundledVersionNewer ) {
		if ( isBundledVersionNewer ) {
			// We keep a copy of the latest installed version instead of removing it.
			await fs.move( latestWPVersionPath, getWordPressVersionPath( latestWPVersion ), {
				overwrite: true,
			} );
		}
		console.log( `Copying bundled WP version ${ bundledWPVersion } as 'latest' version…` );
		await recursiveCopyDirectory( bundledWPVersionPath, latestWPVersionPath );
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
	const isSqliteInstalled = await fs.pathExists( installedSqlitePath );
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

async function copyBundledWPCLI() {
	const bundledWPCLIInstalled = await fs.pathExists( getWpCliPharPath() );
	if ( bundledWPCLIInstalled ) {
		return;
	}
	const bundledWPCLIPath = path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
	await fs.copyFile( bundledWPCLIPath, getWpCliPharPath() );
}

async function copyBundledSqliteCommand() {
	const bundledSqliteCommandPath = path.join( getWpFilesPath(), 'sqlite-command' );
	if ( ! ( await fs.pathExists( bundledSqliteCommandPath ) ) ) {
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
	if ( ! ( await fs.pathExists( bundledTranslationsPath ) ) ) {
		return;
	}
	const installedTranslationsPath = path.join(
		getWordPressVersionPath( 'latest' ),
		'available-site-translations.json'
	);

	await fs.copyFile( bundledTranslationsPath, installedTranslationsPath );
}

async function copyBundledAiInstructions() {
	const bundledAiInstructionsPath = path.join( getWpFilesPath(), 'skills' );
	if ( ! ( await fs.pathExists( bundledAiInstructionsPath ) ) ) {
		return;
	}
	await recursiveCopyDirectory( bundledAiInstructionsPath, getAiInstructionsPath() );
}

async function copyBundledLanguagePacks() {
	const bundledLanguagePacksPath = path.join( getWpFilesPath(), 'latest', 'languages' );
	if ( ! ( await fs.pathExists( bundledLanguagePacksPath ) ) ) {
		return;
	}
	const installedLanguagePacksPath = getLanguagePacksPath();
	await fs.ensureDir( installedLanguagePacksPath );
	await recursiveCopyDirectory( bundledLanguagePacksPath, installedLanguagePacksPath );
}

export async function setupServerFiles() {
	const steps: Array< [ string, () => Promise< void > ] > = [
		[ 'WordPress version', copyBundledLatestWPVersion ],
		[ 'SQLite integration', copyBundledSqlite ],
		[ 'WP-CLI', copyBundledWPCLI ],
		[ 'SQLite command', copyBundledSqliteCommand ],
		[ 'translations', copyBundledTranslations ],
		[ 'language packs', copyBundledLanguagePacks ],
		[ 'AI instructions', copyBundledAiInstructions ],
	];

	for ( const [ name, step ] of steps ) {
		try {
			await step();
		} catch ( error ) {
			console.error( `Failed to set up bundled ${ name }:`, error );
		}
	}
}

export async function updateServerFiles() {
	await updateLatestWordPressVersion();
	await updateLatestWpCliVersion();
	await updateLatestSqliteCommandVersion();
}
