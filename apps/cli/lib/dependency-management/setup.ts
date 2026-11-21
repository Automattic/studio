import fs from 'fs';
import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import semver from 'semver';
import { installFromZip } from './install-from-zip';
import { getBundledWordPressZipPath, getWordPressVersionPath, readBundledManifest } from './paths';
import { getWordPressVersionFromInstallation, updateLatestWordPressVersion } from './wordpress';

// A reader that finds `wp-includes/version.php` copies the directory into a new site straight away.
const isWordPressInstalled = async ( target: string ) =>
	Boolean( await getWordPressVersionFromInstallation( target ) );

function installBundledWordPress( target: string ) {
	return installFromZip( getBundledWordPressZipPath(), 'wordpress', target, isWordPressInstalled );
}

// Compare the WordPress version bundled with the CLI (`wp-files/latest/wordpress.zip`) to
// `~/.studio/server-files/wordpress-versions/latest`. If the bundled version is newer, rename the
// old `wordpress-versions/latest` directory to `wordpress-versions/$VERSION` and unpack the bundled
// one as `wordpress-versions/latest`.
async function copyBundledLatestWpVersion() {
	const bundledWpSemver = semver.coerce( readBundledManifest()?.wordpressVersion );

	if ( ! bundledWpSemver ) {
		return;
	}

	const latestWpVersionPath = getWordPressVersionPath( 'latest' );
	const latestWpVersion = await getWordPressVersionFromInstallation( latestWpVersionPath );
	const latestWpSemver = semver.coerce( latestWpVersion );

	if ( ! latestWpVersion || ! latestWpSemver ) {
		await installBundledWordPress( latestWpVersionPath );
	} else if ( semver.gt( bundledWpSemver, latestWpSemver ) ) {
		try {
			await fs.promises.rename( latestWpVersionPath, getWordPressVersionPath( latestWpVersion ) );
		} catch {
			// Assume the target directory already exists. Do nothing
		}
		await installBundledWordPress( latestWpVersionPath );
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
		const { lastDependencyCheckTime } = ( await readConfig() ).cli;
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
		await updateConfig( ( { cli } ) => {
			cli.lastDependencyCheckTime = Date.now();
		} );
	} catch ( error ) {
		console.error( 'Failed to persist dependency check timestamp:', error );
	}
}

/**
 * Checks for and applies dependency updates (e.g. WordPress versions), throttled
 * to at most once per 24 hours. Returns true if the check ran, false if skipped.
 *
 * A "latest" site can be created from a cache up to a day behind a new release.
 * That's fine: those sites have core auto-updates on, so they catch up on their own.
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
