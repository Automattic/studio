import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { __ } from '@wordpress/i18n';
import archiver from 'archiver';
import { LoggerError } from 'cli/logger';

const ZIP_COMPRESSION_LEVEL = 9;

export async function createArchive(
	siteFolder: string,
	archivePath: string
): Promise< archiver.Archiver > {
	const wpContentFolder = path.join( siteFolder, 'wp-content' );
	const directoryContents = await fsPromises.readdir( wpContentFolder, {
		recursive: true,
	} );

	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( archivePath );
		const archive = archiver( 'zip', {
			zlib: { level: ZIP_COMPRESSION_LEVEL },
		} );

		output.on( 'close', () => {
			resolve( archive );
		} );
		archive.on( 'error', ( error: Error ) => {
			reject( new LoggerError( __( 'Failed to create archive' ), error ) );
		} );

		archive.pipe( output );

		for ( const entryPath of directoryContents ) {
			if ( entryPath.includes( '.git' ) || entryPath.includes( 'node_modules' ) ) {
				continue;
			}

			const absolutePath = path.join( wpContentFolder, entryPath );
			const stat = fs.lstatSync( absolutePath );
			const archivePath = path.relative( siteFolder, absolutePath );

			if ( stat.isFile() ) {
				archive.file( absolutePath, { name: archivePath } );
			} else if ( stat.isSymbolicLink() ) {
				try {
					const realPath = fs.realpathSync( absolutePath );
					archive.file( realPath, { name: archivePath } );
				} catch ( error ) {
					// Ignore errors in the symlinks
				}
			}
		}

		const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
		if ( fs.existsSync( wpConfigPath ) ) {
			archive.file( wpConfigPath, { name: 'wp-config.php' } );
		}

		archive.finalize().catch( reject );
	} );
}

export async function cleanup( archivePath: string ): Promise< void > {
	// Wrap the cleanup logic in a setTimeout to avoid race conditions
	return new Promise( ( resolve ) => {
		setTimeout( () => {
			if ( fs.existsSync( archivePath ) ) {
				fs.unlinkSync( archivePath );
			}
			resolve();
		}, 0 );
	} );
}
