import fs from 'fs';
import os from 'os';
import path from 'path';
import { cacheFunctionTTL } from '@studio/common/lib/cache-function-ttl';
import semver from 'semver';
import { getSqliteCommandPath } from '../server-files';
import { downloadFile, fetchLatestGithubRelease } from './utils';

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
		const versionValue = await fs.promises.readFile(
			path.join( installationPath, 'version' ),
			'utf8'
		);
		return semver.coerce( versionValue );
	} catch ( _error ) {
		return null;
	}
}

const getLatestSqliteCommandRelease = cacheFunctionTTL( () =>
	fetchLatestGithubRelease( 'automattic/wp-cli-sqlite-command' )
);

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
