import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';

export async function downloadFile( url: string, destinationPath: string ): Promise< void > {
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

	await response.body.pipeTo( Writable.toWeb( fs.createWriteStream( destinationPath ) ) );
}
