import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { __ } from '@wordpress/i18n';
import archiver, { EntryData } from 'archiver';
import { LoggerError } from 'cli/logger';

const ZIP_COMPRESSION_LEVEL = 9;

export async function createArchive(
	siteFolder: string,
	archivePath: string
): Promise< archiver.Archiver > {
	const wpContentFolder = path.join( siteFolder, 'wp-content' );
	const directoryContents = await fsPromises.readdir( wpContentFolder, {
		recursive: true,
		withFileTypes: true,
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

		for ( const dirEnt of directoryContents ) {
			const filePath = path.join( dirEnt.parentPath, dirEnt.name );
			if ( shouldExcludeEntry( filePath ) ) {
				continue;
			}

			const archivePath = path.relative( siteFolder, filePath );
			if ( dirEnt.isSymbolicLink() ) {
				const realPath = fs.realpathSync( filePath );
				const stat = fs.statSync( realPath );
				const isDirectory = stat.isDirectory();
				if ( isDirectory ) {
					archive.directory( realPath, archivePath, ( entry: EntryData ) => {
						if ( shouldExcludeEntry( realPath ) ) {
							return false;
						}
						return entry;
					} );
				} else {
					archive.file( realPath, { name: archivePath } );
				}
			} else if ( dirEnt.isFile() ) {
				archive.file( filePath, { name: archivePath } );
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

function shouldExcludeEntry( entryName: string ): boolean {
	return entryName.includes( '.git' ) || entryName.includes( 'node_modules' );
}
