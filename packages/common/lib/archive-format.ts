import fs from 'fs';

const GZIP_MAGIC = [ 0x1f, 0x8b ];

// macOS unpacks the gzip layer of a downloaded .tar.gz when "open safe files"
// is enabled, leaving a plain tar that may keep its original name. Sniffing the
// header keeps us honest when the extension disagrees with the bytes.
export function isGzipFile( filePath: string ): boolean {
	let handle: number | undefined;
	try {
		handle = fs.openSync( filePath, 'r' );
		const buffer = Buffer.alloc( GZIP_MAGIC.length );
		const bytesRead = fs.readSync( handle, buffer, 0, GZIP_MAGIC.length, 0 );
		return bytesRead === GZIP_MAGIC.length && GZIP_MAGIC.every( ( b, i ) => buffer[ i ] === b );
	} catch {
		return false;
	} finally {
		if ( handle !== undefined ) {
			fs.closeSync( handle );
		}
	}
}
