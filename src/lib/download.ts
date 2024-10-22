import { https } from 'follow-redirects';
import fs from 'fs-extra';

export async function download( url: string, filePath: string, showProgress = false, name = '' ) {
	const file = fs.createWriteStream( filePath );

	await new Promise< void >( ( resolve, reject ) => {
		https.get( url, ( response ) => {
			if ( response.statusCode !== 200 ) {
				reject( new Error( `Request failed with status code: ${ response.statusCode }` ) );
				return;
			}

			const totalSize = parseInt( response.headers[ 'content-length' ] ?? '', 10 );
			let downloadedSize = 0;
			const showDownloadProgress =
				showProgress && typeof process.stdout.clearLine === 'function' && ! isNaN( totalSize );
			if ( showDownloadProgress ) {
				response.on( 'data', ( chunk ) => {
					downloadedSize += chunk.length;
					const progress = ( ( downloadedSize / totalSize ) * 100 ).toFixed( 2 );
					process.stdout.clearLine( 0 );
					process.stdout.cursorTo( 0 );
					process.stdout.write( `[${ name }] ${ progress }%` );
				} );
			}

			response.pipe( file );
			response.on( 'end', () => {
				if ( showDownloadProgress ) {
					console.log();
				}
				file.close( () => resolve() );
			} );
			response.on( 'error', ( err ) => reject( err ) );
		} );
	} );
}
