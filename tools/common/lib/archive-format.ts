import fs from 'fs';

export async function isZipArchive( archivePath: string ): Promise< boolean > {
	const handle = await fs.promises.open( archivePath, 'r' );
	try {
		const buffer = Buffer.alloc( 4 );
		const { bytesRead } = await handle.read( buffer, 0, buffer.length, 0 );
		return (
			bytesRead === 4 &&
			buffer[ 0 ] === 0x50 &&
			buffer[ 1 ] === 0x4b &&
			( ( buffer[ 2 ] === 0x03 && buffer[ 3 ] === 0x04 ) ||
				( buffer[ 2 ] === 0x05 && buffer[ 3 ] === 0x06 ) ||
				( buffer[ 2 ] === 0x07 && buffer[ 3 ] === 0x08 ) )
		);
	} finally {
		await handle.close();
	}
}
