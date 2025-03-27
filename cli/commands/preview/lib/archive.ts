import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const ZIP_COMPRESSION_LEVEL = 9;

export async function createArchive(
	siteFolder: string,
	archivePath: string
): Promise< archiver.Archiver > {
	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( archivePath );
		const archive = archiver( 'zip', {
			zlib: { level: ZIP_COMPRESSION_LEVEL },
		} );

		output.on( 'close', () => {
			resolve( archive );
		} );
		archive.on( 'error', ( err: Error ) => {
			reject( err );
		} );

		archive.pipe( output );
		archive.directory( path.join( siteFolder, 'wp-content' ), 'wp-content' );

		const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
		if ( fs.existsSync( wpConfigPath ) ) {
			archive.file( wpConfigPath, { name: 'wp-config.php' } );
		}

		archive.finalize();
	} );
}

export function cleanup( archivePath: string ): void {
	if ( fs.existsSync( archivePath ) ) {
		fs.unlinkSync( archivePath );
	}
}
