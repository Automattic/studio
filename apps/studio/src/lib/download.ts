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

	// When a download starts over https, never let a redirect downgrade it to a
	// cleartext protocol. Otherwise the https:-only guards callers rely on (e.g.
	// the import-backup deeplink, which executes downloaded PHP via Playground)
	// could be bypassed by an attacker-controlled `30x Location: http://…`,
	// re-opening the MITM payload-swap window. http:-initiated downloads keep
	// their existing behaviour.
	const requestOptions =
		urlProtocol === 'https:'
			? {
					beforeRedirect: ( options: { protocol?: string } ) => {
						if ( options.protocol !== 'https:' ) {
							throw new Error(
								`Refusing to follow redirect to insecure protocol "${ options.protocol }".`
							);
						}
					},
			  }
			: {};

	await new Promise< void >( ( resolve, reject ) => {
		const request = httpModule.get( url, requestOptions, ( response ) => {
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
