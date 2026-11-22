import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';

// A fixed date and a sorted file list keep the archive's bytes, and so its hash, the same across
// builds of the same files.
const ENTRY_DATE = new Date( '2000-01-01T00:00:00Z' );

export function listFiles( root: string ): string[] {
	return fs
		.readdirSync( root, { recursive: true, withFileTypes: true } )
		.filter( ( entry ) => entry.isFile() )
		.map( ( entry ) => path.relative( root, path.join( entry.parentPath, entry.name ) ) )
		.sort();
}

// Zips `files`, relative to `root`, into `zipPath`, each under `prefix` inside the archive.
export async function zipFiles(
	zipPath: string,
	root: string,
	files: string[],
	prefix = ''
): Promise< void > {
	await fs.promises.mkdir( path.dirname( zipPath ), { recursive: true } );
	// Concurrent stats would write entries in whatever order they finish.
	const archive = new ZipArchive( { zlib: { level: 9 }, statConcurrency: 1 } );
	const output = fs.createWriteStream( zipPath );
	const written = new Promise< void >( ( resolve, reject ) => {
		output.on( 'close', resolve );
		output.on( 'error', reject );
		archive.on( 'error', reject );
	} );
	archive.pipe( output );
	for ( const file of [ ...files ].sort() ) {
		const name = path.posix.join( prefix, file.split( path.sep ).join( '/' ) );
		archive.file( path.join( root, file ), { name, date: ENTRY_DATE } );
	}
	await archive.finalize();
	await written;
}

export function hashFile( filePath: string ): string {
	return crypto.createHash( 'sha256' ).update( fs.readFileSync( filePath ) ).digest( 'hex' );
}
