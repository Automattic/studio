import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { downloadSQLiteCommand } from '../../vendor/wp-now/src/download';
import { getServerFilesPath } from '../storage/paths';
import { getLatestSQLiteCommandRelease } from './sqlite-command-release';

interface DistributionCheckResult {
	needsDownload: boolean;
	latestVersion: string;
	currentVersion: string | null;
	downloadUrl?: string;
	error?: string;
}

const VERSION_FILE = 'version';

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
		console.log( `Downloading SQLite Command ${ distributionCheck.latestVersion }...` );
		await downloadSQLiteCommand( distributionCheck.downloadUrl, getSqliteCommandPath() );
		await createVersionFile( getSqliteCommandPath(), distributionCheck.latestVersion );
	} catch ( error ) {
		console.error( `Failed to download SQLite Command: ${ error }` );
	}
}

async function checkForUpdate(): Promise< DistributionCheckResult > {
	let currentVersion: string | null = null;
	let distributionExists = false;
	const distributionPath = getSqliteCommandPath();
	const versionFilePath = path.join( distributionPath, 'version' );

	if ( await fs.pathExists( distributionPath ) ) {
		distributionExists = true;
		currentVersion = await getCurrentSQLiteCommandVersion( versionFilePath );
	}

	try {
		const latestRelease = await getLatestSQLiteCommandRelease();
		const latestVersion = latestRelease.tag_name.replace( 'v', '' );
		const needsDownload =
			! distributionExists || ! currentVersion || semver.lt( currentVersion, latestVersion );

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
			latestVersion: '',
			currentVersion,
			error: `Failed to check for distribution: ${ error }`,
		};
	}
}

async function getCurrentSQLiteCommandVersion( versionFilePath: string ) {
	try {
		return ( await fs.readFile( versionFilePath, 'utf8' ) ).trim().replace( 'v', '' );
	} catch ( _error ) {
		return null;
	}
}

async function createVersionFile( CommandPath: string, version: string ): Promise< void > {
	const versionFilePath = path.join( CommandPath, VERSION_FILE );
	await fs.writeFile( versionFilePath, version );
}
