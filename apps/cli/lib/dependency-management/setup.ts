import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import semver from 'semver';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { getWordPressVersionPath, getWpFilesPath } from './paths';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';

const RENAME_ATTEMPTS = 5;

// Copies `source` to `target` through a staging directory beside it, then renames the staging
// directory into place. Several CLI processes run this at once (the app starts more than one), so
// `target` must only ever appear complete: a reader that finds `wp-includes/version.php` there
// copies the directory into a new site straight away.
async function installDirectory( source: string, target: string ) {
	const staging = `${ target }.partial-${ process.pid }-${ crypto.randomUUID() }`;
	try {
		await recursiveCopyDirectory( source, staging );
		for ( let attempt = 1; ; attempt++ ) {
			try {
				await fs.promises.rename( staging, target );
				return;
			} catch ( error ) {
				// Another process installed `target` first, which is as good as our own copy.
				if ( await getWordPressVersionFromInstallation( target ) ) {
					return;
				}
				if ( attempt === RENAME_ATTEMPTS ) {
					throw error;
				}
				// An incomplete `target` left by an interrupted copy blocks the rename, and Windows
				// briefly locks freshly written files (for example while antivirus scans them).
				await fs.promises.rm( target, { recursive: true, force: true } );
				await new Promise( ( resolve ) => setTimeout( resolve, attempt * 200 ) );
			}
		}
	} finally {
		await fs.promises.rm( staging, { recursive: true, force: true } );
	}
}

// Compare the WordPress version in the bundled `wp-files/latest/wordpress` directory (that ships
// with the CLI) to `~/.studio/server-files/wordpress-versions/latest`. If the bundled directory is
// newer, rename the old `wordpress-versions/latest` directory to `wordpress-versions/$VERSION` and
// install the bundled directory as `wordpress-versions/latest`.
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
		await installDirectory( bundledWpVersionPath, latestWpVersionPath );
	} else if ( semver.gt( bundledWpSemver, latestWpSemver ) ) {
		try {
			await fs.promises.rename( latestWpVersionPath, getWordPressVersionPath( latestWpVersion ) );
		} catch {
			// Assume the target directory already exists. Do nothing
		}
		await installDirectory( bundledWpVersionPath, latestWpVersionPath );
	}
}

export async function setupServerFiles() {
	const steps: [ string, () => Promise< void > ][] = [
		[ 'WordPress version', copyBundledLatestWpVersion ],
	];

	for ( const [ name, step ] of steps ) {
		try {
			await step();
		} catch ( error ) {
			console.error( `Failed to set up dependency ${ name }:`, error );
		}
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
 *
 * @param force Bypass the throttle. Site creation passes this for "latest",
 *              which installs by copying the cached directory instead of
 *              downloading a numbered release, so the cache has to be current.
 */
export async function updateServerFiles( force = false ): Promise< boolean > {
	if ( ! force && ! ( await shouldCheckDependencyUpdates() ) ) {
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
