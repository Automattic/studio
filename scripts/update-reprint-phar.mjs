/**
 * Downloads the latest reprint.phar release from GitHub and saves it to
 * apps/cli/lib/import/reprint.phar.  Run manually or via `npm run update-reprint`.
 *
 * Uses the GitHub API to find the latest release of the
 * adamziel/streaming-site-migration repo, then downloads the reprint.phar
 * asset from that release.
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const REPO = 'adamziel/streaming-site-migration';
const ASSET_NAME = 'reprint.phar';
const OUTPUT_PATH = path.join( __dirname, '..', 'apps', 'cli', 'lib', 'import', ASSET_NAME );

function httpsGetJson( url ) {
	return new Promise( ( resolve, reject ) => {
		https.get(
			url,
			{ headers: { 'User-Agent': 'studio-reprint-updater', Accept: 'application/json' } },
			( response ) => {
				if ( response.statusCode >= 300 && response.statusCode < 400 && response.headers.location ) {
					return resolve( httpsGetJson( response.headers.location ) );
				}

				const chunks = [];
				response.on( 'data', ( chunk ) => chunks.push( chunk ) );
				response.on( 'end', () => {
					try {
						resolve( JSON.parse( Buffer.concat( chunks ).toString() ) );
					} catch ( err ) {
						reject( err );
					}
				} );
				response.on( 'error', reject );
			}
		);
	} );
}

function httpsDownload( url, dest ) {
	return new Promise( ( resolve, reject ) => {
		https.get( url, { headers: { 'User-Agent': 'studio-reprint-updater' } }, ( response ) => {
			if ( response.statusCode >= 300 && response.statusCode < 400 && response.headers.location ) {
				return resolve( httpsDownload( response.headers.location, dest ) );
			}

			if ( response.statusCode !== 200 ) {
				reject( new Error( `HTTP ${ response.statusCode } downloading ${ url }` ) );
				return;
			}

			const file = fs.createWriteStream( dest );
			response.pipe( file );
			file.on( 'finish', () => file.close( resolve ) );
			file.on( 'error', reject );
		} );
	} );
}

console.log( `[reprint] Fetching latest release from ${ REPO }…` );

const release = await httpsGetJson( `https://api.github.com/repos/${ REPO }/releases/latest` );
const asset = release.assets?.find( ( a ) => a.name === ASSET_NAME );

if ( ! asset ) {
	console.error(
		`[reprint] No ${ ASSET_NAME } asset found in release ${ release.tag_name }. Available assets:`,
		release.assets?.map( ( a ) => a.name )
	);
	process.exit( 1 );
}

console.log( `[reprint] Downloading ${ ASSET_NAME } ${ release.tag_name } (${ asset.size } bytes)…` );

fs.mkdirSync( path.dirname( OUTPUT_PATH ), { recursive: true } );
await httpsDownload( asset.browser_download_url, OUTPUT_PATH );
fs.chmodSync( OUTPUT_PATH, 0o755 );

console.log( `[reprint] Saved to ${ OUTPUT_PATH }` );
