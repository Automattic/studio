import fs from 'fs';
import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import semver from 'semver';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { getWordPressVersionPath, getWpFilesPath } from './paths';
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
