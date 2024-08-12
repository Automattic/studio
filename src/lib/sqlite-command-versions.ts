import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import semver, { SemVer } from 'semver';
import { downloadSQLiteCommand } from '../../vendor/wp-now/src/download';
import { getServerFilesPath } from '../storage/paths';
import { getLatestSQLiteCommandRelease } from './sqlite-command-release';

interface DistributionCheckResult {
	needsDownload: boolean;
	latestVersion: SemVer | null;
	currentVersion: SemVer | null;
	downloadUrl?: string;
	error?: string;
}

const VERSION_FILENAME = 'version';

/**
 * The path for wp-cli phar file within the WP Now folder.
 */
export function getSqliteCommandPath() {
	if ( process.env.NODE_ENV !== 'test' ) {
		return path.join( getServerFilesPath(), 'sqlite-command' );
	}

	const tmpPath = path.join( os.tmpdir(), `wp-now-tests-wp-sqlite-command-hidden-folder` );
	fs.ensureDirSync( tmpPath );
	return tmpPath;
}

export async function updateLatestSQLiteCommandVersion() {
	const distributionCheck = await checkForUpdate();

	if ( distributionCheck.error ) {
		console.error( distributionCheck.error );
		return;
	}

	if ( ! distributionCheck.downloadUrl ) {
		console.log( 'Could not determine the download URL for the latest SQLite command release.' );
		return;
	}

	if ( ! distributionCheck.needsDownload ) {
		console.log( 'SQLite Command is up to date.' );
		return;
	}

	try {
		await downloadSQLiteCommand( distributionCheck.downloadUrl, getSqliteCommandPath() );
	} catch ( error ) {
		console.error( `Failed to download SQLite Command: ${ error }` );
	}
}

async function checkForUpdate(): Promise< DistributionCheckResult > {
	let currentVersion: SemVer | null = null;
	let distributionExists = false;
	const distributionPath = getSqliteCommandPath();

	if ( await fs.pathExists( distributionPath ) ) {
		distributionExists = true;
		currentVersion = await getSQLiteCommandVersion( distributionPath );
	}

	try {
		const latestRelease = await getLatestSQLiteCommandRelease();
		const latestVersion = semver.coerce( latestRelease.tag_name );
		const needsDownload =
			! distributionExists ||
			! currentVersion ||
			( !! latestVersion && semver.lt( currentVersion, latestVersion ) );

		const downloadUrl = latestRelease.assets?.[ 0 ].browser_download_url;

		return {
			needsDownload,
			latestVersion,
			currentVersion,
			downloadUrl,
		};
	} catch ( error ) {
		return {
			needsDownload: false,
			latestVersion: null,
			currentVersion,
			error: `Failed to check for distribution: ${ error }`,
		};
	}
}

export async function getSQLiteCommandVersion( distributionPath: string ) {
	try {
		const versionValue = await fs.readFile(
			path.join( distributionPath, VERSION_FILENAME ),
			'utf8'
		);
		return semver.coerce( versionValue );
	} catch ( _error ) {
		return null;
	}
}
