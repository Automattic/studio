import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { getWordPressVersionPath } from '../vendor/wp-now/src/download';
import { recursiveCopyDirectory } from './lib/fs-utils';
import {
	getWordPressVersionFromInstallation,
	updateLatestWordPressVersion,
} from './lib/wp-versions';
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
		console.log( `Copying embedded WP version ${ bundledWPVersion } as 'latest' version...` );
		await recursiveCopyDirectory( bundledWPVersionPath, latestWPVersionPath );
	}
}

export default async function setupWPVersions() {
	await copyBundledLatestWPVersion();
	await updateLatestWordPressVersion();
}
