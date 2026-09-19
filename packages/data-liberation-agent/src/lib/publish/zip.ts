// src/lib/publish/zip.ts
//
// Minimal ZIP writer over node:zlib. Publish targets accept a liberated site
// as a single archive, and the format is small and stable enough that a
// dependency is not worth carrying: entries are deflated (stored when deflate
// does not help), then framed with local headers, a central directory, and an
// end-of-central-directory record.
//
// Scope is deliberately narrow — regular files, no ZIP64, no encryption, no
// directory entries. A liberated site is a flat set of file paths.
//
import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
	/** Archive-relative POSIX path. */
	path: string;
	contents: Buffer;
}

const STORED = 0;
const DEFLATED = 8;
/** MS-DOS epoch: ZIP timestamps start at 1980, and a fixed value keeps archives reproducible. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const crcTable = ( () => {
	const table = new Uint32Array( 256 );
	for ( let index = 0; index < 256; index++ ) {
		let value = index;
		for ( let bit = 0; bit < 8; bit++ ) {
			value = value & 1 ? 0xedb88320 ^ ( value >>> 1 ) : value >>> 1;
		}
		table[ index ] = value >>> 0;
	}
	return table;
} )();

export function crc32( input: Buffer ): number {
	let crc = 0xffffffff;
	for ( const byte of input ) crc = crcTable[ ( crc ^ byte ) & 0xff ]! ^ ( crc >>> 8 );
	return ( crc ^ 0xffffffff ) >>> 0;
}

function assertSafePath( path: string ): string {
	const normalized = path.split( '\\' ).join( '/' ).replace( /^\/+/, '' );
	if ( ! normalized ) throw new Error( 'zip entry path is empty' );
	if ( normalized.split( '/' ).some( ( segment ) => segment === '..' ) ) {
		throw new Error( `zip entry path escapes the archive: ${ path }` );
	}
	return normalized;
}

/** Build a ZIP archive containing every entry, in the order given. */
export function createZipArchive( entries: readonly ZipEntry[] ): Buffer {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let offset = 0;
	let count = 0;

	for ( const entry of entries ) {
		const name = Buffer.from( assertSafePath( entry.path ), 'utf8' );
		const deflated = deflateRawSync( entry.contents );
		// Storing beats deflating for already-compressed or tiny payloads.
		const useDeflate = deflated.length < entry.contents.length;
		const payload = useDeflate ? deflated : entry.contents;
		const method = useDeflate ? DEFLATED : STORED;
		const checksum = crc32( entry.contents );

		const local = Buffer.alloc( 30 );
		local.writeUInt32LE( 0x04034b50, 0 );
		local.writeUInt16LE( 20, 4 ); // version needed
		local.writeUInt16LE( 0x0800, 6 ); // UTF-8 filename flag
		local.writeUInt16LE( method, 8 );
		local.writeUInt16LE( DOS_TIME, 10 );
		local.writeUInt16LE( DOS_DATE, 12 );
		local.writeUInt32LE( checksum, 14 );
		local.writeUInt32LE( payload.length, 18 );
		local.writeUInt32LE( entry.contents.length, 22 );
		local.writeUInt16LE( name.length, 26 );
		local.writeUInt16LE( 0, 28 ); // extra field length
		localParts.push( local, name, payload );

		const central = Buffer.alloc( 46 );
		central.writeUInt32LE( 0x02014b50, 0 );
		central.writeUInt16LE( 20, 4 ); // version made by
		central.writeUInt16LE( 20, 6 ); // version needed
		central.writeUInt16LE( 0x0800, 8 );
		central.writeUInt16LE( method, 10 );
		central.writeUInt16LE( DOS_TIME, 12 );
		central.writeUInt16LE( DOS_DATE, 14 );
		central.writeUInt32LE( checksum, 16 );
		central.writeUInt32LE( payload.length, 20 );
		central.writeUInt32LE( entry.contents.length, 24 );
		central.writeUInt16LE( name.length, 28 );
		central.writeUInt16LE( 0, 30 ); // extra
		central.writeUInt16LE( 0, 32 ); // comment
		central.writeUInt16LE( 0, 34 ); // disk number
		central.writeUInt16LE( 0, 36 ); // internal attrs
		// Bitwise math is signed in JS; coerce back to unsigned before writing.
		central.writeUInt32LE( ( 0o100644 << 16 ) >>> 0, 38 ); // external attrs: regular file, 0644
		central.writeUInt32LE( offset, 42 );
		centralParts.push( central, name );

		offset += local.length + name.length + payload.length;
		count++;
	}

	const centralDirectory = Buffer.concat( centralParts );
	const end = Buffer.alloc( 22 );
	end.writeUInt32LE( 0x06054b50, 0 );
	end.writeUInt16LE( 0, 4 ); // disk number
	end.writeUInt16LE( 0, 6 ); // central directory start disk
	end.writeUInt16LE( count, 8 );
	end.writeUInt16LE( count, 10 );
	end.writeUInt32LE( centralDirectory.length, 12 );
	end.writeUInt32LE( offset, 16 );
	end.writeUInt16LE( 0, 20 ); // comment length

	return Buffer.concat( [ ...localParts, centralDirectory, end ] );
}
