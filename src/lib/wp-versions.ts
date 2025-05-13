import { net } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { pathExists, recursiveCopyDirectory } from 'src/lib/fs-utils';
import { DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';
import { downloadWordPress, getWordPressVersionPath } from 'vendor/wp-now/src/download';
import { executeWPCli } from 'vendor/wp-now/src/execute-wp-cli';

export const MINIMUM_SUPPORTED_WP_VERSION = 6;

async function fetchWordPressVersions() {
	try {
		const response = await fetch( 'https://api.wordpress.org/core/stable-check/1.0/' );
		const versionsStatus: Record< string, string > = await response.json();
		const versions = Object.keys( versionsStatus )
			.filter( ( item ) => {
				const version = semver.coerce( item );
				const minVersion = semver.coerce( MINIMUM_SUPPORTED_WP_VERSION );
				return version && minVersion && semver.gte( version, minVersion );
			} )
			.sort( ( a, b ) => {
				const versionA = semver.coerce( a );
				const versionB = semver.coerce( b );
				if ( ! versionA || ! versionB ) {
					return 0;
				}
				return semver.compare( versionA, versionB );
			} )
			.reverse();
		const latestVersion = Object.keys( versionsStatus ).find(
			( index ) => versionsStatus[ index ] === 'latest'
		);
		return { versions, latest: latestVersion };
	} catch ( exception ) {
		return { versions: [], latest: DEFAULT_WORDPRESS_VERSION };
	}
}

async function getLatestWordPressVersion() {
	const wordPressVersions = await fetchWordPressVersions();
	return wordPressVersions.latest ?? DEFAULT_WORDPRESS_VERSION;
}

export async function getWordPressVersionFromInstallation( installationPath: string ) {
	let versionFileContent = '';
	try {
		versionFileContent = await fs.readFile(
			path.join( installationPath, 'wp-includes', 'version.php' ),
			'utf8'
		);
	} catch ( err ) {
		return null;
	}
	const matches = versionFileContent.match( /\$wp_version\s*=\s*'([0-9a-zA-Z.-]+)'/ );
	return matches?.[ 1 ];
}

export async function updateLatestWordPressVersion() {
	let shouldOverwrite = false;
	const latestVersionPath = getWordPressVersionPath( 'latest' );
	const latestVersionFiles = ( await fs.pathExists( latestVersionPath ) )
		? await fs.readdir( latestVersionPath )
		: [];
	if ( latestVersionFiles.length !== 0 ) {
		const installedVersion = await getWordPressVersionFromInstallation( latestVersionPath );
		const latestVersion = await getLatestWordPressVersion();
		if ( installedVersion && latestVersion !== 'latest' && installedVersion !== latestVersion ) {
			// We keep a copy of the latest installed version instead of removing it.
			await recursiveCopyDirectory(
				latestVersionPath,
				getWordPressVersionPath( installedVersion )
			);
			shouldOverwrite = true;
		}
	}
	await downloadWordPress( 'latest', { overwrite: shouldOverwrite } );
}

/**
 * Deletes the wp-config.php file at the specified path.
 *
 * Prior to enforcing Playground's WordPress mode, it was possible to run
 * alternative modes, which mutated Studio's bundled WordPress installation.
 * To rectify the situation, we remove the erroneous wp-config.php file.
 *
 * If we are confident this situation is not a widespread issue, we can remove
 * this function in the future.
 *
 * @param wpVersion - The WordPress version the wp-config.php file.
 */
export async function purgeWpConfig( wpVersion: string ) {
	const wpVersionPath = getWordPressVersionPath( wpVersion );
	const wpConfigPath = path.join( wpVersionPath, 'wp-config.php' );

	if ( ! ( await pathExists( wpConfigPath ) ) ) {
		return;
	}

	await fs.promises.unlink( wpConfigPath );
}

/**
 * Verifies the checksums of a WordPress installation.
 * If checksums don't match, it will retry the download once.
 *
 * @param wpVersion - The WordPress version to verify
 * @throws Error if checksums don't match after retry or if verification fails
 */
export async function verifyWordPressChecksums( wpVersion: string ): Promise< void > {
	if ( ! net.isOnline() ) {
		console.log( 'Skipping WordPress checksum verification - offline mode' );
		return;
	}

	try {
		console.log( `Verifying checksums for WordPress version ${ wpVersion }...` );
		const result = await executeWPCli( getWordPressVersionPath( wpVersion ), [
			'core',
			'verify-checksums',
			'--skip-plugins',
			'--skip-themes',
		] );

		if ( result.exitCode !== 0 ) {
			console.log( `Checksums don't match for WordPress ${ wpVersion }, retrying download...` );
			await fs.remove( getWordPressVersionPath( wpVersion ) );
			// Retry download one more time
			await downloadWordPress( wpVersion, { overwrite: true } );
		}
	} catch ( error ) {
		console.error( `Failed to verify WordPress checksums:`, error );
		throw new Error(
			`Failed to verify WordPress version ${ wpVersion }. Please try again or use a different version.`
		);
	}
}
