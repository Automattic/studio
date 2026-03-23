import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cacheFunctionTTL } from '@studio/common/lib/cache-function-ttl';
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

const wpCliVersionsSchema = z.object( { tag_name: z.string() } );

const getLatestWPCliVersion = cacheFunctionTTL( async (): Promise< string > => {
	const headers: HeadersInit = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'wp-now-cli',
	};

	// GitHub API has rate limits:
	// - 60 requests/hour for unauthenticated requests
	// - 5,000 requests/hour with token authentication
	// In CI environments, the IP-based rate limit is shared across runners,
	// so we authenticate with GITHUB_TOKEN when available.
	if ( process.env.GITHUB_TOKEN ) {
		headers.Authorization = `token ${ process.env.GITHUB_TOKEN }`;
	}

	const response = await fetch( 'https://api.github.com/repos/wp-cli/wp-cli/releases/latest', {
		headers,
	} );

	if ( ! response.ok ) {
		throw new Error( `GitHub API request failed: ${ response.status } ${ response.statusText }` );
	}

	const rawResponse: unknown = await response.json();

	const parsed = wpCliVersionsSchema.parse( rawResponse );
	return parsed.tag_name;
} );

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
