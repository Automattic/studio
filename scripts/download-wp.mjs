import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import extract from 'extract-zip';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

console.log( 'Downloading latest WordPress version ...' );

const zipPath = path.join( __dirname, '..', 'wp-files', 'latest.zip' );
const extractedPath = path.join( __dirname, '..', 'wp-files', 'latest' );
try {
	fs.mkdirSync( path.dirname( zipPath ) );
	fs.mkdirSync( extractedPath );
} catch ( err ) {
	if ( err.code !== 'EEXIST' ) throw err;
}
const zipFile = fs.createWriteStream( zipPath );

await new Promise( ( resolve, reject ) => {
	https.get( 'https://wordpress.org/latest.zip', ( response ) => {
		const totalSize = parseInt( response.headers[ 'content-length' ], 10 );
		let downloadedSize = 0;

		response.on( 'data', ( chunk ) => {
			downloadedSize += chunk.length;
			const progress = ( ( downloadedSize / totalSize ) * 100 ).toFixed( 2 );
			process.stdout.clearLine();
			process.stdout.cursorTo( 0 );
			process.stdout.write( `${ progress }%` );
		} );

		response.pipe( zipFile );
		response.on( 'end', () => {
			console.log( '\nDownload complete' );
			zipFile.close( () => resolve() );
		} );
		response.on( 'error', ( err ) => reject( err ) );
	} );
} );

console.log( 'Extracting WordPress files ...' );
await extract( zipPath, { dir: extractedPath } );
console.log( 'Extracted WordPress files' );
