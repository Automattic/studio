import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractZip } from '@studio/common/lib/extract-zip';
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
import { downloadFile } from './utils';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';
import { downloadWpCli, updateLatestWpCliVersion } from './wp-cli';

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
const SQLITE_PLUGIN_DOWNLOAD_URL =
	'https://downloads.wordpress.org/plugin/sqlite-database-integration.latest-stable.zip';

async function downloadSqliteIntegration(): Promise< void > {
	const tmpDownloadPath = path.join( os.tmpdir(), `sqlite-integration-${ crypto.randomUUID() }.zip` );
	const tmpExtractPath = path.join( os.tmpdir(), `sqlite-integration-${ crypto.randomUUID() }` );

	try {
		await downloadFile( SQLITE_PLUGIN_DOWNLOAD_URL, tmpDownloadPath );
		await extractZip( tmpDownloadPath, tmpExtractPath );
		const extractedDir = path.join( tmpExtractPath, SQLITE_FILENAME );
		if ( fs.existsSync( extractedDir ) ) {
			await recursiveCopyDirectory( extractedDir, getSqlitePluginPath() );
		}
	} finally {
		await fs.promises.rm( tmpDownloadPath, { force: true } );
		await fs.promises.rm( tmpExtractPath, { recursive: true, force: true } );
	}
}

async function copyBundledSqlite() {
	const installedSqlitePath = getSqlitePluginPath();
	const isSqliteInstalled = fs.existsSync( installedSqlitePath );

	const bundledSqlitePath = path.join( getWpFilesPath(), SQLITE_FILENAME );
	const bundledSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( bundledSqlitePath ),
		{ includePrerelease: true }
	);

	// No bundled version available (e.g. dev build) — download if not already installed.
	if ( ! bundledSqliteVersion ) {
		if ( ! isSqliteInstalled ) {
			await downloadSqliteIntegration();
		}
		return;
	}

	const installedSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( installedSqlitePath ),
		{ includePrerelease: true }
	);
	const isBundledVersionNewer =
		installedSqliteVersion && semver.gt( bundledSqliteVersion, installedSqliteVersion );
	if ( ! isSqliteInstalled || isBundledVersionNewer ) {
		await recursiveCopyDirectory( bundledSqlitePath, getSqlitePluginPath() );
	}
}

async function copyBundledWpCli() {
	if ( fs.existsSync( getWpCliPharPath() ) ) {
		return;
	}
	const bundledWpCLIPath = path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
	if ( fs.existsSync( bundledWpCLIPath ) ) {
		await fs.promises.copyFile( bundledWpCLIPath, getWpCliPharPath() );
	} else {
		// Bundled WP-CLI not available (e.g. dev build) — download it directly.
		await downloadWpCli();
	}
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

async function copyBundledPhpMyAdmin() {
	const bundledPath = path.join( getWpFilesPath(), 'phpmyadmin' );
	if ( ! fs.existsSync( bundledPath ) ) {
		return;
	}
	// Always copy to ensure files are complete and up-to-date
	await recursiveCopyDirectory( bundledPath, getPhpMyAdminPath() );
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
