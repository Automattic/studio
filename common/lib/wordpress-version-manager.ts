import { IncomingMessage } from 'http';
import os from 'os';
import path from 'path';
import followRedirects, { FollowResponse } from 'follow-redirects';
import fs from 'fs-extra';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import unzipper from 'unzipper';
import { pathExists } from './fs-utils';
import { getWordPressVersionUrl } from './wordpress-version-utils';

const { https } = followRedirects;

/**
 * WordPress Version Manager
 *
 * Handles downloading and caching of specific WordPress versions.
 * Does NOT handle offline fallback logic - that should be handled by the caller.
 */

/**
 * HTTP GET with proxy support
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

interface DownloadResult {
	downloaded: boolean;
	statusCode: number;
}

/**
 * Download and unzip a file from URL to destination folder
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
	let statusCode: number = 0;
	try {
		if ( fs.existsSync( checkFinalPath ) && ! overwrite ) {
			return { downloaded: false, statusCode: 0 };
		}

		fs.ensureDirSync( destinationFolder );
		const response = await new Promise< IncomingMessage >( ( resolve ) =>
			httpsGet( url, ( response ) => resolve( response ) )
		);

		statusCode = response.statusCode ?? 0;
		if ( response.statusCode !== 200 ) {
			throw new Error( `Failed to download file (Status code ${ response.statusCode }).` );
		}

		const entryPromises: Promise< void >[] = [];

		await new Promise< void >( ( resolve, reject ) => {
			const unzipStream = unzipper.Parse();

			unzipStream.on( 'entry', ( entry ) => {
				const entryPath = entry.path;
				const fullPath = path.join( destinationFolder, entryPath );

				if ( entry.type === 'Directory' ) {
					entry.autodrain();
					return;
				}

				const entryPromise = new Promise< void >( ( resolveEntry, rejectEntry ) => {
					fs.ensureDirSync( path.dirname( fullPath ) );
					const writeStream = fs.createWriteStream( fullPath );

					entry.pipe( writeStream );

					writeStream.on( 'close', () => resolveEntry() );
					writeStream.on( 'error', ( error: unknown ) => rejectEntry( error ) );
					entry.on( 'error', ( error: unknown ) => rejectEntry( error ) );
				} );

				entryPromises.push( entryPromise );
			} );

			unzipStream.on( 'close', () => resolve() );
			unzipStream.on( 'error', ( error: unknown ) => reject( error ) );

			response.pipe( unzipStream );
		} );

		// Wait until all entries have been extracted before continuing
		await Promise.all( entryPromises );

		console.log( `Downloaded ${ itemName } to ${ checkFinalPath }` );
		return { downloaded: true, statusCode };
	} catch ( err ) {
		console.error( `Error downloading or unzipping ${ itemName }:`, err );
	}
	return { downloaded: false, statusCode };
}

/**
 * Get the storage path for a specific WordPress version
 *
 * Special case: 'latest' version uses bundled location at server-files/latest/wordpress/
 * All other versions use server-files/wordpress-versions/{version}/
 */
export function getWordPressVersionPath( wpVersion: string, serverFilesPath: string ): string {
	if ( wpVersion === 'latest' ) {
		// Special case: 'latest' version uses bundled location
		return path.join( serverFilesPath, 'latest', 'wordpress' );
	}
	// All other versions use the versioned structure
	return path.join( serverFilesPath, 'wordpress-versions', wpVersion );
}

/**
 * Check if a WordPress version is already cached locally
 *
 * For 'latest': checks bundled location at server-files/latest/wordpress/
 * For other versions: checks downloaded cache at server-files/wordpress-versions/{version}/
 */
export async function isWordPressVersionCached(
	wpVersion: string,
	serverFilesPath: string
): Promise< boolean > {
	const versionPath = getWordPressVersionPath( wpVersion, serverFilesPath );
	return await pathExists( versionPath );
}

/**
 * Download and cache a specific WordPress version
 *
 * Note: 'latest' version is not downloaded as it's always bundled with the app
 */
export async function downloadWordPressVersion(
	wpVersion: string,
	serverFilesPath: string
): Promise< void > {
	if ( wpVersion === 'latest' ) {
		// 'latest' version is bundled, not downloaded - this shouldn't be called
		throw new Error( 'Cannot download "latest" version - it is provided as bundled files' );
	}
	const finalFolder = getWordPressVersionPath( wpVersion, serverFilesPath );
	const tempDir = await fs.mkdtemp( path.join( os.tmpdir(), 'wordpress-download-' ) );

	try {
		const { downloaded, statusCode } = await downloadFileAndUnzip( {
			url: getWordPressVersionUrl( wpVersion ),
			destinationFolder: tempDir,
			checkFinalPath: finalFolder,
			itemName: `WordPress ${ wpVersion }`,
			overwrite: false,
		} );

		if ( ! downloaded ) {
			throw new Error(
				`Failed to download WordPress version ${ wpVersion }. Status code: ${ statusCode }`
			);
		}

		// WordPress zip files contain a 'wordpress' folder, we want the contents
		const wordpressFolder = path.join( tempDir, 'wordpress' );
		if ( await pathExists( wordpressFolder ) ) {
			await fs.ensureDir( path.dirname( finalFolder ) );
			await fs.move( wordpressFolder, finalFolder, { overwrite: true } );
		} else {
			throw new Error(
				`Downloaded WordPress archive does not contain expected 'wordpress' folder`
			);
		}
	} finally {
		// Clean up temp directory
		await fs.remove( tempDir ).catch( () => {
			// Ignore cleanup errors
		} );
	}
}
