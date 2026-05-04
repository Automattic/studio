import fs from 'fs';
import https from 'https';
import path from 'path';

console.log(
	'[available-site-translations] Downloading information of available translations for latest WordPress version ...'
);

const jsonFilePath = path.join(
	import.meta.dirname,
	'..',
	'wp-files',
	'latest',
	'available-site-translations.json'
);
fs.mkdirSync( path.dirname( jsonFilePath ), { recursive: true } );
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
