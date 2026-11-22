import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';

// Writes a zip holding `files`, keyed by their path inside the archive.
export async function writeZip( zipPath: string, files: Record< string, string > ) {
	fs.mkdirSync( path.dirname( zipPath ), { recursive: true } );
	const archive = new ZipArchive();
	const output = fs.createWriteStream( zipPath );
	const closed = new Promise< void >( ( resolve ) => output.on( 'close', () => resolve() ) );
	archive.pipe( output );
	for ( const [ name, content ] of Object.entries( files ) ) {
		archive.append( content, { name } );
	}
	await archive.finalize();
	await closed;
}
