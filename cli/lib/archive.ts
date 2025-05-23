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
	const symlinks = await getSymlinks( wpContentFolder );

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
		archive.directory(
			path.join( siteFolder, 'wp-content' ),
			'wp-content',
			( entry: EntryData ) => {
				if ( shouldExcludeEntry( entry.name ) ) {
					return false;
				}
				if ( entry.stats?.isSymbolicLink() ) {
					return false;
				}

				return entry;
			}
		);

		for ( const symlink of symlinks ) {
			const { symbolicPath, realPath } = symlink;
			const archivePath = path.relative( siteFolder, symbolicPath );
			if ( symlink.isDirectory ) {
				archive.directory( realPath, archivePath, ( entry: EntryData ) => {
					if ( shouldExcludeEntry( entry.name ) ) {
						return false;
					}
					return entry;
				} );
			} else {
				archive.file( realPath, { name: archivePath } );
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

async function getSymlinks(
	dir: string
): Promise< { isDirectory: boolean; symbolicPath: string; realPath: string }[] > {
	const files = await fs.promises.readdir( dir );
	const results = await Promise.all(
		files.map( async ( file ) => {
			const filePath = path.join( dir, file );
			const stats = await fs.promises.lstat( filePath );

			if ( stats.isSymbolicLink() ) {
				const realPath = await fsPromises.realpath( filePath );
				const realPathStats = await fsPromises.stat( realPath );
				return [ { isDirectory: realPathStats.isDirectory(), symbolicPath: filePath, realPath } ];
			}

			if ( stats.isDirectory() ) {
				return await getSymlinks( filePath );
			}
			if ( stats.isFile() ) {
				return [];
			}
			return [];
		} )
	);
	return results.flat();
}

function shouldExcludeEntry( entryName: string ): boolean {
	return entryName.includes( '.git' ) || entryName.includes( 'node_modules' );
}
