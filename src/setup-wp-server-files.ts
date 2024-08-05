import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { SQLITE_FILENAME } from '../vendor/wp-now/src/constants';
import { getWordPressVersionPath } from '../vendor/wp-now/src/download';
import getSqlitePath from '../vendor/wp-now/src/get-sqlite-path';
import getWpCliPath from '../vendor/wp-now/src/get-wp-cli-path';
import { recursiveCopyDirectory } from './lib/fs-utils';
import { getSqliteVersionFromInstallation, updateLatestSqliteVersion } from './lib/sqlite-versions';
import {
	getWordPressVersionFromInstallation,
	updateLatestWordPressVersion,
} from './lib/wp-versions';
import { updateLatestWPCliVersion } from './lib/wpcli-versions';
import { getResourcesPath } from './storage/paths';

// Tries to copy the app's bundled WordPress version to `wp-now` WP versions if needed
async function copyBundledLatestWPVersion() {
	const bundledWPVersionPath = path.join( getResourcesPath(), 'wp-files', 'latest', 'wordpress' );
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
		console.log( `Copying bundled WP version ${ bundledWPVersion } as 'latest' version...` );
		await recursiveCopyDirectory( bundledWPVersionPath, latestWPVersionPath );
	}
}

async function copyBundledSqlite() {
	const bundledSqlitePath = path.join( getResourcesPath(), 'wp-files', SQLITE_FILENAME );
	const bundledSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( bundledSqlitePath )
	);
	if ( ! bundledSqliteVersion ) {
		return;
	}
	const installedSqlitePath = getSqlitePath();
	const isSqliteInstalled = await fs.pathExists( installedSqlitePath );
	const installedSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( installedSqlitePath )
	);
	const isBundledVersionNewer =
		installedSqliteVersion && semver.gt( bundledSqliteVersion, installedSqliteVersion );
	if ( ! isSqliteInstalled || isBundledVersionNewer ) {
		console.log( `Copying bundled SQLite version ${ bundledSqliteVersion }...` );
		await recursiveCopyDirectory( bundledSqlitePath, getSqlitePath() );
	}
}

async function copyBundledWPCLI() {
	const bundledWPCLIInstalled = await fs.pathExists( getWpCliPath() );
	if ( bundledWPCLIInstalled ) {
		return;
	}
	const bundledWPCLIPath = path.join( getResourcesPath(), 'wp-files', 'wp-cli', 'wp-cli.phar' );
	await fs.copyFile( bundledWPCLIPath, getWpCliPath() );
}
export async function setupWPServerFiles() {
	await copyBundledLatestWPVersion();
	await copyBundledSqlite();
	await copyBundledWPCLI();
}

export async function updateWPServerFiles() {
	await updateLatestWordPressVersion();
	await updateLatestSqliteVersion();
	await updateLatestWPCliVersion();
}
