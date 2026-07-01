import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { isErrnoException } from './is-errno-exception';

export async function downloadFile(
	url: string,
	destinationPath: string,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< void > {
	try {
		await fs.promises.mkdir( path.dirname( destinationPath ), { recursive: true } );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code !== 'EEXIST' ) {
			throw error;
		}
	}

	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( `Request failed with status code: ${ response.status }` );
	}
	if ( ! response.body ) {
		throw new Error( 'Download response did not include a readable body.' );
	}

	if ( ! onProgress ) {
		await response.body.pipeTo( Writable.toWeb( fs.createWriteStream( destinationPath ) ) );
		return;
	}

	const total = Number( response.headers.get( 'content-length' ) ) || 0;
	let downloaded = 0;
	const PROGRESS_CHUNK = 512 * 1024; // report every 512 KB
	let nextReport = PROGRESS_CHUNK;

	const writer = fs.createWriteStream( destinationPath );
	const reader = response.body.getReader();
	try {
		while ( true ) {
			const { done, value } = await reader.read();
			if ( done ) break;
			writer.write( value );
			downloaded += value.byteLength;
			if ( downloaded >= nextReport ) {
				onProgress( downloaded, total );
				nextReport = downloaded + PROGRESS_CHUNK;
			}
		}
	} finally {
		reader.releaseLock();
		await new Promise< void >( ( resolve, reject ) => {
			writer.end( ( err: Error | null | undefined ) => ( err ? reject( err ) : resolve() ) );
		} );
	}
	onProgress( downloaded, total );
}
