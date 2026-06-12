import { open } from 'fs/promises';

export async function readFileTail( filePath: string, maxBytes: number ): Promise< string > {
	const file = await open( filePath, 'r' );
	try {
		const { size } = await file.stat();
		const length = Math.min( size, maxBytes );
		if ( length === 0 ) {
			return '';
		}
		const { buffer } = await file.read( {
			buffer: Buffer.alloc( length ),
			position: size - length,
		} );
		let tail = buffer.toString( 'utf8' );
		if ( length < size ) {
			// Drop the first, likely partial, line of a truncated read.
			tail = tail.slice( tail.indexOf( '\n' ) + 1 );
		}
		return tail.trim();
	} finally {
		await file.close();
	}
}
