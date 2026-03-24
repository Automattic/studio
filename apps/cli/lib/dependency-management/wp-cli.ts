import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cacheFunctionTTL } from '@studio/common/lib/cache-function-ttl';
import semver from 'semver';
import { runGlobalWpCliCommand } from '../run-wp-cli-command';
import { getWpCliPharPath } from '../server-files';
import { downloadFile, fetchLatestGithubRelease } from './utils';

async function getWPCliVersionFromInstallation(): Promise< string > {
	const [ response, exitPhp ] = await runGlobalWpCliCommand( [ 'wp', '--version' ] );

	try {
		const stdout = await response.stdoutText;
		if ( stdout.startsWith( 'WP-CLI ' ) ) {
			return stdout.split( ' ' )[ 1 ];
		}
	} finally {
		exitPhp();
	}

	return '';
}

const getLatestWpCliRelease = cacheFunctionTTL( () => fetchLatestGithubRelease( 'wp-cli/wp-cli' ) );

async function isWPCliInstallationOutdated(): Promise< boolean > {
	const installedVersion = await getWPCliVersionFromInstallation();

	if ( ! installedVersion ) {
		return true;
	}

	const latestRelease = await getLatestWpCliRelease();

	if ( ! latestRelease ) {
		return false;
	}

	try {
		return semver.lt( installedVersion, latestRelease.tag_name );
	} catch {
		return false;
	}
}

const WP_CLI_URL = 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar';

export async function updateLatestWpCliVersion(): Promise< void > {
	const isOutdated = await isWPCliInstallationOutdated();

	if ( isOutdated ) {
		const tmpDownloadPath = path.join( os.tmpdir(), `wp-cli-${ crypto.randomUUID() }.zip` );

		try {
			await downloadFile( WP_CLI_URL, tmpDownloadPath );
			await fs.promises.copyFile( tmpDownloadPath, getWpCliPharPath() );
		} finally {
			await fs.promises.rm( tmpDownloadPath, { force: true } );
		}
	}
}
