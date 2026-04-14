/**
 * Download utilities for WordPress, WP-CLI, and SQLite command
 *
 */

import { IncomingMessage } from 'http';
import os from 'os';
import path from 'path';
import { extractZip } from '@studio/common/lib/extract-zip';
import followRedirects, { FollowResponse } from 'follow-redirects';
import fs from 'fs-extra';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import { getWordPressVersionPath } from './server-files-paths';

const { https } = followRedirects;

// Constants
const DEFAULT_WORDPRESS_VERSION = 'latest';

interface DownloadResult {
	downloaded: boolean;
	statusCode: number;
}

/**
 * Make an HTTPS GET request with proxy support
 */
function httpsGet( url: string, callback: ( res: IncomingMessage & FollowResponse ) => void ) {
	const proxy =
		process.env.https_proxy ||
		process.env.HTTPS_PROXY ||
		process.env.http_proxy ||
		process.env.HTTP_PROXY;

	let agent: HttpsProxyAgent | HttpProxyAgent | undefined;

	if ( proxy ) {
		const urlParts = new URL( url );
		const Agent = urlParts.protocol === 'https:' ? HttpsProxyAgent : HttpProxyAgent;
		agent = new Agent( { proxy } );
	}

	https.get( url, { agent }, callback );
}

/**
 * Check if a WordPress version is a dev/nightly build
 */
function isWordPressDevVersion( version: string ): boolean {
	return /^\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)*-\d+$/.test( version );
}

/**
 * Check if a WordPress version string is valid
 */
function isValidWordPressVersion( version: string ): boolean {
	const versionPattern =
		/^latest$|^(?:(\d+)\.(\d+)(?:\.(\d+))?)((?:-beta(?:\d+)?)|(?:-RC(?:\d+)?))?$/;
	return versionPattern.test( version );
}

/**
 * Get the download URL for a WordPress version
 */
function getWordPressVersionUrl( version = DEFAULT_WORDPRESS_VERSION ): string {
	if ( isWordPressDevVersion( version ) ) {
		return 'https://wordpress.org/nightly-builds/wordpress-latest.zip';
	}

	if ( ! isValidWordPressVersion( version ) ) {
		throw new Error(
			'Unrecognized WordPress version. Please use "latest" or numeric versions such as "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
		);
	}
	return `https://wordpress.org/wordpress-${ version }.zip`;
}

/**
 * Download and unzip a file
 */
async function downloadFileAndUnzip( {
	url,
	destinationFolder,
	checkFinalPath,
	itemName,
	overwrite = false,
}: {
	url: string;
	destinationFolder: string;
	checkFinalPath: string;
	itemName: string;
	overwrite?: boolean;
} ): Promise< DownloadResult > {
	if ( ! overwrite && fs.existsSync( checkFinalPath ) ) {
		console.log( `${ itemName } folder already exists. Skipping download.` );
		return { downloaded: false, statusCode: 0 };
	}

	let statusCode = 0;
	const tempZipPath = path.join( os.tmpdir(), `${ Date.now() }-${ path.basename( url ) }` );

	try {
		await fs.ensureDir( path.dirname( destinationFolder ) );

		console.log( `Downloading ${ itemName }...` );
		const response = await new Promise< IncomingMessage >( ( resolve ) =>
			httpsGet( url, ( response ) => resolve( response ) )
		);
		statusCode = response.statusCode ?? 0;

		if ( response.statusCode !== 200 ) {
			throw new Error( `Failed to download file (Status code ${ response.statusCode }).` );
		}

		await new Promise< void >( ( resolve, reject ) => {
			const file = fs.createWriteStream( tempZipPath );
			response.pipe( file );
			file.on( 'finish', () => {
				file.close();
				resolve();
			} );
			file.on( 'error', ( error ) => {
				file.close();
				reject( error );
			} );
		} );

		await extractZip( tempZipPath, destinationFolder );

		return { downloaded: true, statusCode };
	} catch ( err ) {
		console.error( `Error downloading or unzipping ${ itemName }:`, err );
	} finally {
		// Clean up temp file
		if ( fs.existsSync( tempZipPath ) ) {
			try {
				await fs.remove( tempZipPath );
			} catch ( cleanupErr ) {
				console.error( 'Error cleaning up temp zip file:', cleanupErr );
			}
		}
	}
	return { downloaded: false, statusCode };
}

/**
 * Download a specific WordPress version
 */
export async function downloadWordPress(
	wordPressVersion = DEFAULT_WORDPRESS_VERSION,
	{ overwrite }: { overwrite: boolean } = { overwrite: false }
): Promise< void > {
	const finalFolder = getWordPressVersionPath( wordPressVersion );
	const tempDir = await fs.mkdtemp( path.join( os.tmpdir(), 'wordpress-download-' ) );

	try {
		const { downloaded, statusCode } = await downloadFileAndUnzip( {
			url: getWordPressVersionUrl( wordPressVersion ),
			destinationFolder: tempDir,
			checkFinalPath: finalFolder,
			itemName: `WordPress ${ wordPressVersion }`,
			overwrite,
		} );

		if ( downloaded ) {
			const wpSourcePath = path.join( tempDir, 'wordpress' );
			await fs.ensureDir( path.dirname( finalFolder ) );
			await fs.move( wpSourcePath, finalFolder, {
				overwrite: true,
			} );
		} else if ( 404 === statusCode ) {
			console.log(
				`WordPress ${ wordPressVersion } not found. Check https://wordpress.org/download/releases/ for available versions.`
			);
		}
	} finally {
		if ( tempDir && fs.existsSync( tempDir ) ) {
			try {
				await fs.remove( tempDir );
			} catch ( cleanupErr ) {
				console.error( 'Error cleaning up temporary directory:', cleanupErr );
			}
		}
	}
}

/**
 * Download SQLite command
 */
export async function downloadSQLiteCommand(
	downloadUrl: string,
	targetPath: string
): Promise< void > {
	const tempFolder = path.join( os.tmpdir(), 'wp-cli-sqlite-command' );
	const { downloaded, statusCode } = await downloadFileAndUnzip( {
		url: downloadUrl,
		destinationFolder: tempFolder,
		checkFinalPath: targetPath,
		itemName: 'SQLite Command',
		overwrite: true,
	} );

	if ( ! downloaded ) {
		throw new Error( `Failed to download SQLite CLI command. Status code: ${ statusCode }` );
	}

	await fs.ensureDir( path.dirname( targetPath ) );

	await fs.move( tempFolder, targetPath, {
		overwrite: true,
	} );
}
