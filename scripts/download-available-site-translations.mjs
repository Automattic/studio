import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

console.log(
	'[available-site-translations] Downloading information of available translations for latest WordPress version ...'
);

const jsonFilePath = path.join(
	__dirname,
	'..',
	'wp-files',
	'latest',
	'available-site-translations.json'
);
try {
	fs.mkdirSync( path.dirname( jsonFilePath ) );
} catch ( err ) {
	if ( err.code !== 'EEXIST' ) throw err;
}
const jsonFile = fs.createWriteStream( jsonFilePath );

await new Promise( ( resolve, reject ) => {
	https.get( 'https://api.wordpress.org/translations/core/1.0/', ( response ) => {
		response.pipe( jsonFile );
		response.on( 'end', () => {
			console.log( '[available-site-translations] Download complete' );
			jsonFile.close( () => resolve() );
		} );
		response.on( 'error', ( err ) => reject( err ) );
	} );
} );
