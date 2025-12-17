import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { recursiveCopyDirectory } from 'common/lib/fs-utils';
import {
	getSqliteCommandPath,
	updateLatestSQLiteCommandVersion,
	getSQLiteCommandVersion,
} from 'src/lib/sqlite-command-versions';
import { getSqliteVersionFromInstallation } from 'src/lib/sqlite-versions';
import { getSqlitePath, getWordPressProvider } from 'src/lib/wordpress-provider';
import { WpNowProvider } from 'src/lib/wordpress-provider/wp-now';
import {
	getWordPressVersionFromInstallation,
	updateLatestWordPressVersion,
} from 'src/lib/wp-versions';
import { getResourcesPath } from 'src/storage/paths';

// Tries to copy the app's bundled WordPress version to `wp-now` WP versions if needed
export async function copyBundledLatestWPVersion() {
	const bundledWPVersionPath = path.join( getResourcesPath(), 'wp-files', 'latest', 'wordpress' );
	const bundledWPVersion = semver.coerce(
		await getWordPressVersionFromInstallation( bundledWPVersionPath )
	);
	if ( ! bundledWPVersion ) {
		return;
	}
	const latestWPVersionPath = WpNowProvider.getWordPressVersionPath( 'latest' );
	const latestWPVersion = await getWordPressVersionFromInstallation( latestWPVersionPath );
	const latestWPSemVersion = semver.coerce( latestWPVersion );
	const isBundledVersionNewer =
		latestWPVersion && latestWPSemVersion && semver.gt( bundledWPVersion, latestWPSemVersion );
	if ( ! latestWPVersion || isBundledVersionNewer ) {
		if ( isBundledVersionNewer ) {
			// We keep a copy of the latest installed version instead of removing it.
			await fs.move(
				latestWPVersionPath,
				WpNowProvider.getWordPressVersionPath( latestWPVersion ),
				{
					overwrite: true,
				}
			);
		}
		console.log( `Copying bundled WP version ${ bundledWPVersion } as 'latest' version…` );
		await recursiveCopyDirectory( bundledWPVersionPath, latestWPVersionPath );
	}
}

async function copyBundledSqlite() {
	const bundledSqlitePath = path.join(
		getResourcesPath(),
		'wp-files',
		getWordPressProvider().SQLITE_FILENAME
	);
	const bundledSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( bundledSqlitePath ),
		{
			includePrerelease: true,
		}
	);
	if ( ! bundledSqliteVersion ) {
		return;
	}
	const installedSqlitePath = getSqlitePath();
	const isSqliteInstalled = await fs.pathExists( installedSqlitePath );
	const installedSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( installedSqlitePath ),
		{
			includePrerelease: true,
		}
	);
	const isBundledVersionNewer =
		installedSqliteVersion && semver.gt( bundledSqliteVersion, installedSqliteVersion );
	if ( ! isSqliteInstalled || isBundledVersionNewer ) {
		console.log( `Copying bundled SQLite version ${ bundledSqliteVersion }…` );
		await recursiveCopyDirectory( bundledSqlitePath, getSqlitePath() );
	}
}

async function copyBundledWPCLI() {
	const bundledWPCLIInstalled = await fs.pathExists( WpNowProvider.getWpCliPath() );
	if ( bundledWPCLIInstalled ) {
		return;
	}
	const bundledWPCLIPath = path.join( getResourcesPath(), 'wp-files', 'wp-cli', 'wp-cli.phar' );
	await fs.copyFile( bundledWPCLIPath, WpNowProvider.getWpCliPath() );
}

async function copyBundledSQLiteCommand() {
	const bundledSqliteCommandPath = path.join( getResourcesPath(), 'wp-files', 'sqlite-command' );
	const bundledSqliteCommandVersion = await getSQLiteCommandVersion( bundledSqliteCommandPath );
	if ( ! bundledSqliteCommandVersion ) {
		return;
	}
	const installedSqliteCommandPath = getSqliteCommandPath();
	const isSqliteCommandInstalled = await fs.pathExists( installedSqliteCommandPath );

	const installedSqliteCommandVersion = await getSQLiteCommandVersion( installedSqliteCommandPath );
	const isBundledVersionNewer =
		installedSqliteCommandVersion &&
		semver.gt( bundledSqliteCommandVersion, installedSqliteCommandVersion );
	if ( ! isSqliteCommandInstalled || isBundledVersionNewer ) {
		console.log( `Copying bundled SQLite command version ${ bundledSqliteCommandVersion }…` );
		await recursiveCopyDirectory( bundledSqliteCommandPath, installedSqliteCommandPath );
	}
}

async function copyBundledTranslations() {
	const bundledTranslationsPath = path.join(
		getResourcesPath(),
		'wp-files',
		'latest',
		'available-site-translations.json'
	);
	if ( ! ( await fs.pathExists( bundledTranslationsPath ) ) ) {
		return;
	}
	const installedTranslationsPath = path.join(
		WpNowProvider.getWordPressVersionPath( 'latest' ),
		'available-site-translations.json'
	);
	// Always copy the bundled translations file to ensure CLI has access to it
	await fs.copyFile( bundledTranslationsPath, installedTranslationsPath );
}

export async function setupWPServerFiles() {
	await copyBundledLatestWPVersion();
	await copyBundledSqlite();
	await copyBundledWPCLI();
	await copyBundledSQLiteCommand();
	await copyBundledTranslations();
}

export async function updateWPServerFiles() {
	await updateLatestWordPressVersion();
	const provider = new WpNowProvider();
	await provider.updateLatestWPCliVersion();

	await updateLatestSQLiteCommandVersion();
}
