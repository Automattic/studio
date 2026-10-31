import fs from 'fs';
import { Readable } from 'stream';

export async function downloadBackup( url: string, destPath: string ): Promise< void > {
	const response = await fetch( url );
	if ( ! response.ok || ! response.body ) {
		throw new Error( 'Failed to download backup' );
	}

	const fileStream = fs.createWriteStream( destPath );
	const readable = Readable.fromWeb( response.body as import('stream/web').ReadableStream );

	return new Promise< void >( ( resolve, reject ) => {
		readable.pipe( fileStream );
		fileStream.on( 'finish', resolve );
		fileStream.on( 'error', reject );
		readable.on( 'error', reject );
	} );
}
