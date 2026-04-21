import fs from 'fs';
import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import semver from 'semver';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import {
	getPhpMyAdminPath,
	getSqliteCommandPath,
	getSqlitePluginPath,
	getWordPressVersionPath,
	getWpCliPharPath,
	getWpFilesPath,
} from '../server-files';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';

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
	const sourcePath = path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
	if ( ! fs.existsSync( sourcePath ) ) {
		return;
	}
	const targetPath = getWpCliPharPath();
	const sourceStats = await fs.promises.lstat( sourcePath );
	let shouldCopy = false;
	try {
		const targetStats = await fs.promises.lstat( targetPath );
		shouldCopy =
			sourceStats.size !== targetStats.size ||
			Math.floor( sourceStats.mtimeMs ) !== Math.floor( targetStats.mtimeMs );
	} catch {
		shouldCopy = true;
	}
	if ( shouldCopy ) {
		await fs.promises.mkdir( path.dirname( targetPath ), { recursive: true } );
		await fs.promises.cp( sourcePath, targetPath, {
			mode: fs.constants.COPYFILE_FICLONE,
			preserveTimestamps: true,
		} );
	}
}

async function copyBundledDirectoryIfMissing( sourcePath: string, targetPath: string ) {
	if ( ! fs.existsSync( sourcePath ) ) {
		return;
	}
	if ( fs.existsSync( targetPath ) ) {
		return;
	}
	await recursiveCopyDirectory( sourcePath, targetPath );
}

// Seed `~/.studio/server-files/` from the bundled `wp-files/` directory. WordPress is always
// copied (since it may be updated at runtime by `updateServerFiles`). wp-cli, sqlite-command,
// and phpMyAdmin are copied to user-writable paths so PHP-wasm can mount them without hitting
// permission or file-handle issues that affect mounts pointing directly into the macOS app bundle.
export async function setupServerFiles() {
	try {
		await copyBundledLatestWpVersion();
	} catch ( error ) {
		console.error( 'Failed to set up dependency WordPress version:', error );
	}

	try {
		await copyBundledWpCli();
	} catch ( error ) {
		console.error( 'Failed to set up bundled WP-CLI:', error );
	}

	try {
		await copyBundledDirectoryIfMissing(
			path.join( getWpFilesPath(), 'sqlite-command' ),
			getSqliteCommandPath()
		);
	} catch ( error ) {
		console.error( 'Failed to set up bundled SQLite command:', error );
	}

	try {
		await copyBundledDirectoryIfMissing(
			path.join( getWpFilesPath(), 'sqlite-database-integration' ),
			getSqlitePluginPath()
		);
	} catch ( error ) {
		console.error( 'Failed to set up bundled SQLite plugin:', error );
	}

	try {
		await copyBundledDirectoryIfMissing(
			path.join( getWpFilesPath(), 'phpmyadmin' ),
			getPhpMyAdminPath()
		);
	} catch ( error ) {
		console.error( 'Failed to set up bundled phpMyAdmin:', error );
	}
}

export const DEPENDENCY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function shouldCheckDependencyUpdates(): Promise< boolean > {
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

async function markDependencyCheckTime(): Promise< void > {
	try {
		await updateCliConfigWithPartial( { lastDependencyCheckTime: Date.now() } );
	} catch ( error ) {
		console.error( 'Failed to persist dependency check timestamp:', error );
	}
}

/**
 * Checks for and applies dependency updates (e.g. WordPress versions), throttled
 * to at most once per 24 hours. Returns true if the check ran, false if skipped.
 */
export async function updateServerFiles(): Promise< boolean > {
	if ( ! ( await shouldCheckDependencyUpdates() ) ) {
		return false;
	}

	try {
		await updateLatestWordPressVersion();
	} catch ( error ) {
		console.error( 'Failed to update dependency WordPress version:', error );
	}

	await markDependencyCheckTime();
	return true;
}
