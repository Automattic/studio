import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import yauzl from 'yauzl';

const openZip = promisify< string, yauzl.Options, yauzl.ZipFile >( yauzl.open );

export async function extractZip( zipPath: string, destinationFolder: string ): Promise< void > {
	const zipFile = await openZip( zipPath, { lazyEntries: true } );
	const openReadStream = promisify( zipFile.openReadStream.bind( zipFile ) );
	const resolvedDestination = path.resolve( destinationFolder );

	return new Promise( ( resolve, reject ) => {
		zipFile.on( 'entry', async ( entry: yauzl.Entry ) => {
			if ( entry.fileName.endsWith( '/' ) ) {
				zipFile.readEntry();
				return;
			}

			const normalizedPath = path.normalize( entry.fileName );
			const fullPath = path.join( resolvedDestination, normalizedPath );

			if ( ! fullPath.startsWith( resolvedDestination + path.sep ) ) {
				console.warn( `Skipping invalid path: ${ entry.fileName }` );
				zipFile.readEntry();
				return;
			}

			try {
				await fs.promises.mkdir( path.dirname( fullPath ), { recursive: true } );

				const readStream = await openReadStream( entry );
				const writeStream = fs.createWriteStream( fullPath );

				function onError( error: Error ) {
					if ( ! readStream.destroyed ) {
						readStream.destroy();
					}
					if ( ! writeStream.destroyed ) {
						writeStream.destroy();
					}
					reject( error );
				}

				readStream.once( 'error', onError );
				writeStream.once( 'error', onError );

				writeStream.once( 'finish', () => {
					zipFile.readEntry();
				} );

				readStream.pipe( writeStream );
			} catch ( error ) {
				reject( error );
			}
		} );

		zipFile.on( 'end', () => {
			resolve();
		} );

		zipFile.on( 'error', reject );

		zipFile.readEntry();
	} );
}
