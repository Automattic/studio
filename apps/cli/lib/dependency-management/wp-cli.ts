import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import semver from 'semver';
import { z } from 'zod';
import { runGlobalWpCliCommand } from '../run-wp-cli-command';
import { getWpCliPharPath } from '../server-files';
import { downloadFile } from './utils';

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

let latestWPCliVersionCache = '';
const wpCliVersionsSchema = z.array( z.object( { tag_name: z.string() } ) );

async function getLatestWPCliVersion(): Promise< string > {
	if ( latestWPCliVersionCache ) {
		return latestWPCliVersionCache;
	}

	try {
		const response = await fetch(
			'https://api.github.com/repos/wp-cli/wp-cli/releases?per_page=1'
		);
		const data: unknown = await response.json();
		const parsed = wpCliVersionsSchema.parse( data );
		latestWPCliVersionCache = parsed[ 0 ].tag_name;
	} catch {
		// Discard the failed fetch, return the cache
	}

	return latestWPCliVersionCache;
}

async function isWPCliInstallationOutdated(): Promise< boolean > {
	const installedVersion = await getWPCliVersionFromInstallation();
	const latestVersion = await getLatestWPCliVersion();

	if ( ! installedVersion ) {
		return true;
	}

	if ( ! latestVersion ) {
		return false;
	}

	try {
		return semver.lt( installedVersion, latestVersion );
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
			await fs.promises.unlink( tmpDownloadPath );
		}
	}
}
