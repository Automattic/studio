import path from 'path';
import fs from 'fs-extra';
import { downloadSQLiteCommand } from '../../vendor/wp-now/src/download';
import { getServerFilesPath } from '../storage/paths';

interface GithubRelease {
	tag_name: string;
	assets?: {
		name: string;
		browser_download_url: string;
	}[];
}

interface DistributionCheckResult {
	needsDownload: boolean;
	latestVersion: string;
	currentVersion: string | null;
	downloadUrl?: string;
	isUpdate: boolean;
	error?: string;
}

const VERSION_FILE = 'version';

/**
 * The path for wp-cli phar file within the WP Now folder.
 */
export function getSqliteCommandPath() {
	return path.join( getServerFilesPath(), 'sqlite-command' );
}

// Check if library exists
// Get the latest release
// Check if the library is outdated
// Download the latest release
// Extract the release
// Update the version file

export async function updateLatestSQLiteCommandVersion() {
	const distributionCheck = await checkForUpdate(
		getSqliteCommandPath(),
		path.join( getSqliteCommandPath(), 'version' )
	);

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

async function checkForUpdate(
	distributionPath: string,
	versionFilePath: string
): Promise< DistributionCheckResult > {
	let currentVersion: string | null = null;
	let distributionExists = false;

	if ( await fs.pathExists( distributionPath ) ) {
		distributionExists = true;
		currentVersion = await getCurrentSQLiteCommandVersion( versionFilePath );
	}

	try {
		const latestRelease = await getLatestSQLiteCommandRelease();
		const latestVersion = latestRelease.tag_name.replace( 'v', '' );
		const needsDownload =
			! distributionExists || ! currentVersion || latestVersion > currentVersion;

		let downloadUrl;
		if ( needsDownload && latestRelease.assets?.length ) {
			downloadUrl = latestRelease.assets[ 0 ].browser_download_url;
		}

		return {
			needsDownload,
			latestVersion,
			currentVersion,
			downloadUrl,
			isUpdate: distributionExists && needsDownload,
		};
	} catch ( error ) {
		return {
			needsDownload: false,
			latestVersion: '',
			currentVersion,
			isUpdate: false,
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

async function getLatestSQLiteCommandRelease(): Promise< GithubRelease > {
	const response = await fetch(
		`https://api.github.com/repos/automattic/wp-cli-sqlite-command/releases/latest`
	);
	return ( await response.json() ) as GithubRelease;
}

async function createVersionFile( CommandPath: string, version: string ): Promise< void > {
	const versionFilePath = path.join( CommandPath, VERSION_FILE );
	await fs.writeFile( versionFilePath, version );
}