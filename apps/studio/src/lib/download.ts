import { https, http } from 'follow-redirects';
import fs from 'fs-extra';

export async function download(
	url: string,
	filePath: string,
	showProgress = false,
	name = '',
	signal?: AbortSignal
) {
	const file = fs.createWriteStream( filePath );
	const urlProtocol = new URL( url ).protocol;
	const httpModule = urlProtocol === 'https:' ? https : http;

	await new Promise< void >( ( resolve, reject ) => {
		const request = httpModule.get( url, ( response ) => {
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

		if ( signal ) {
			signal.addEventListener( 'abort', () => {
				request.destroy();
				file.close();
				fs.remove( filePath ).catch( () => {
					// Ignore errors during cleanup
				} );
				reject( new Error( 'Download aborted' ) );
			} );
		}

		request.on( 'error', ( err ) => {
			file.close();
			fs.remove( filePath ).catch( () => {
				// Ignore errors during cleanup
			} );
			reject( err );
		} );
	} );
}
