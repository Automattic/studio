import os from 'os';
import path from 'path';
import { cacheFunctionTTL } from '@studio/common/lib/cache-function-ttl';
import fs from 'fs-extra';
import semver from 'semver';
import { z } from 'zod';
import { getSqliteCommandPath } from '../server-files';
import { downloadFile } from './utils';

async function needsUpdate(): Promise< boolean > {
	const installationPath = getSqliteCommandPath();

	if ( ! fs.existsSync( installationPath ) ) {
		return true;
	}

	const currentVersion = await getSqliteCommandVersion( installationPath );

	if ( ! currentVersion ) {
		return true;
	}

	const latestRelease = await getLatestSqliteCommandRelease();
	return semver.lt( currentVersion, latestRelease.tag_name );
}

async function getSqliteCommandVersion( installationPath: string ) {
	try {
		const versionValue = await fs.readFile( path.join( installationPath, 'version' ), 'utf8' );
		return semver.coerce( versionValue );
	} catch ( _error ) {
		return null;
	}
}

const sqliteGithubReleaseSchema = z.object( {
	tag_name: z.string(),
	assets: z.array( z.object( { name: z.string(), browser_download_url: z.string() } ) ),
} );

const getLatestSqliteCommandRelease = cacheFunctionTTL( async () => {
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

	const response = await fetch(
		'https://api.github.com/repos/automattic/wp-cli-sqlite-command/releases/latest',
		{ headers }
	);

	if ( ! response.ok ) {
		throw new Error( `GitHub API request failed: ${ response.status } ${ response.statusText }` );
	}

	const rawResponse: unknown = await response.json();

	return sqliteGithubReleaseSchema.parse( rawResponse );
} );

export async function updateLatestSqliteCommandVersion() {
	const isNeedingUpdate = await needsUpdate();

	if ( ! isNeedingUpdate ) {
		return;
	}

	const latestRelease = await getLatestSqliteCommandRelease();
	const downloadUrl = latestRelease.assets?.[ 0 ].browser_download_url;
	const tmpDownloadPath = path.join( os.tmpdir(), `sqlite-command-${ crypto.randomUUID() }.zip` );

	try {
		await downloadFile( downloadUrl, tmpDownloadPath );
		await fs.promises.copyFile( tmpDownloadPath, getSqliteCommandPath() );
	} finally {
		await fs.promises.unlink( tmpDownloadPath );
	}
}
