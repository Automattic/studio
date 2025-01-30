import { IncomingMessage } from 'http';
import os from 'os';
import path from 'path';
import followRedirects, { FollowResponse } from 'follow-redirects';
import fs from 'fs-extra';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import unzipper from 'unzipper';
import { DEFAULT_WORDPRESS_VERSION, SQLITE_FILENAME, SQLITE_URL, WP_CLI_URL } from './constants';
import getSqlitePath from './get-sqlite-path';
import getWordpressVersionsPath from './get-wordpress-versions-path';
import getWpCliPath from './get-wp-cli-path';
import { output } from './output';
import { isValidWordPressVersion } from './wp-playground-wordpress';

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

function getWordPressVersionUrl( version = DEFAULT_WORDPRESS_VERSION ) {
	if ( ! isValidWordPressVersion( version ) ) {
		throw new Error(
			'Unrecognized WordPress version. Please use "latest" or numeric versions such as "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
		);
	}
	return `https://wordpress.org/wordpress-${ version }.zip`;
}

interface DownloadFileAndUnzipResult {
	downloaded: boolean;
	statusCode: number;
}

const { https } = followRedirects;

async function downloadFile( {
	url,
	destinationFilePath,
	itemName,
	overwrite = false,
} ): Promise< DownloadFileAndUnzipResult > {
	let statusCode = 0;
	try {
		if ( fs.existsSync( destinationFilePath ) && ! overwrite ) {
			return { downloaded: false, statusCode: 0 };
		}
		fs.ensureDirSync( path.dirname( destinationFilePath ) );
		const response = await new Promise< IncomingMessage >( ( resolve ) =>
			httpsGet( url, ( response ) => resolve( response ) )
		);
		statusCode = response.statusCode;
		if ( response.statusCode !== 200 ) {
			throw new Error( `Failed to download file (Status code ${ response.statusCode }).` );
		}
		await new Promise< void >( ( resolve, reject ) => {
			fs.ensureFileSync( destinationFilePath );
			const file = fs.createWriteStream( destinationFilePath );
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
		output?.log( `Downloaded ${ itemName } to ${ destinationFilePath }` );
		return { downloaded: true, statusCode };
	} catch ( error ) {
		output?.error( `Error downloading file ${ itemName }`, error );
		return { downloaded: false, statusCode };
	}
}

export async function downloadWpCli( overwrite = false ) {
	return downloadFile( {
		url: WP_CLI_URL,
		destinationFilePath: getWpCliPath(),
		itemName: 'wp-cli',
		overwrite,
	} );
}

async function downloadFileAndUnzip( {
	url,
	destinationFolder,
	checkFinalPath,
	itemName,
	overwrite = false,
} ): Promise< DownloadFileAndUnzipResult > {
	if ( ! overwrite && fs.existsSync( checkFinalPath ) ) {
		output?.log( `${ itemName } folder already exists. Skipping download.` );
		return { downloaded: false, statusCode: 0 };
	}

	let statusCode = 0;

	try {
		await fs.ensureDir( path.dirname( destinationFolder ) );

		output?.log( `Downloading ${ itemName }...` );
		const response = await new Promise< IncomingMessage >( ( resolve ) =>
			httpsGet( url, ( response ) => resolve( response ) )
		);
		statusCode = response.statusCode;

		if ( response.statusCode !== 200 ) {
			throw new Error( `Failed to download file (Status code ${ response.statusCode }).` );
		}

		const entryPromises: Promise< unknown >[] = [];

		/**
		 * Using Parse because Extract is broken:
		 * https://github.com/WordPress/wordpress-playground/issues/248
		 */
		await response
			.pipe( unzipper.Parse() )
			.on( 'entry', ( entry ) => {
				const filePath = path.join( destinationFolder, entry.path );
				/*
				 * Use the sync version to ensure entry is piped to
				 * a write stream before moving on to the next entry.
				 */
				fs.ensureDirSync( path.dirname( filePath ) );

				if ( entry.type === 'Directory' ) {
					entryPromises.push( entry.autodrain().promise() );
				} else {
					const promise = new Promise( ( resolve, reject ) => {
						entry
							.pipe( fs.createWriteStream( filePath ) )
							.on( 'close', resolve )
							.on( 'error', reject );
					} );
					entryPromises.push( promise );
				}
			} )
			.promise();

		// Wait until all entries have been extracted before continuing
		await Promise.all( entryPromises );

		return { downloaded: true, statusCode };
	} catch ( err ) {
		output?.error( `Error downloading or unzipping ${ itemName }:`, err );
	}
	return { downloaded: false, statusCode };
}

export async function downloadWordPress(
	wordPressVersion = DEFAULT_WORDPRESS_VERSION,
	{ overwrite }: { overwrite: boolean } = { overwrite: false }
) {
	const finalFolder = getWordPressVersionPath( wordPressVersion );
	const tempFolder = os.tmpdir();
	const { downloaded, statusCode } = await downloadFileAndUnzip( {
		url: getWordPressVersionUrl( wordPressVersion ),
		destinationFolder: tempFolder,
		checkFinalPath: finalFolder,
		itemName: `WordPress ${ wordPressVersion }`,
		overwrite,
	} );
	if ( downloaded ) {
		await fs.ensureDir( path.dirname( finalFolder ) );
		await fs.move( path.join( tempFolder, 'wordpress' ), finalFolder, {
			overwrite: true,
		} );
	} else if ( 404 === statusCode ) {
		output?.log(
			`WordPress ${ wordPressVersion } not found. Check https://wordpress.org/download/releases/ for available versions.`
		);
	}
}

export async function downloadSqliteIntegrationPlugin(
	{ overwrite }: { overwrite: boolean } = { overwrite: false }
) {
	const finalFolder = getSqlitePath();
	const tempFolder = path.join( os.tmpdir(), SQLITE_FILENAME );
	const { downloaded, statusCode } = await downloadFileAndUnzip( {
		url: SQLITE_URL,
		destinationFolder: tempFolder,
		checkFinalPath: finalFolder,
		itemName: 'SQLite',
		overwrite,
	} );
	if ( downloaded ) {
		const nestedFolder = path.join( tempFolder, SQLITE_FILENAME );
		await fs.ensureDir( path.dirname( finalFolder ) );
		await fs.move( nestedFolder, finalFolder, {
			overwrite: true,
		} );
	} else if ( 0 !== statusCode ) {
		throw Error( 'An error ocurred when download SQLite' );
	}
}

export async function downloadSQLiteCommand( downloadUrl: string, targetPath: string ) {
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

	await fs.move( path.join( tempFolder ), targetPath, {
		overwrite: true,
	} );
}
export function getWordPressVersionPath( wpVersion: string ) {
	return path.join( getWordpressVersionsPath(), wpVersion );
}

/**
 * This function removes the internal mu-plugins that WP-now used to store.
 *
 * WP-now used to store some internal mu-plugins in the site's mu-plugins directory.
 * This prevented users from using the mu-plugins directory for their own plugins,
 * so Studio now mounts the mu-plugins directory to the shared mu-plugins directory.
 *
 * @param projectPath The path to the project directory.
 */
export async function removeDownloadedMuPlugins( projectPath: string ) {
	const wpContentPath = path.join( projectPath, 'wp-content' );
	const muPluginsPath = path.join( wpContentPath, 'mu-plugins' );
	fs.removeSync( path.join( muPluginsPath, '0-32bit-integer-warnings.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-allowed-redirect-hosts.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-check-theme-availability.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-deactivate-jetpack-modules.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-dns-functions.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-permalinks.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-wp-config-constants-polyfill.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-sqlite.php' ) );
	fs.removeSync( path.join( muPluginsPath, '0-thumbnails.php' ) );
}
