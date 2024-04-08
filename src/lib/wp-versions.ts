import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { DEFAULT_WORDPRESS_VERSION } from '../../vendor/wp-now/src/constants';
import { downloadWordPress, getWordPressVersionPath } from '../../vendor/wp-now/src/download';
import { recursiveCopyDirectory } from './fs-utils';

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
