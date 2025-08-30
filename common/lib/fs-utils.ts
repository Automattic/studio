import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import { isErrnoException } from './is-errno-exception';

/**
 * Calculates the total size of a directory by recursively traversing its contents.
 *
 * @param directoryPath - The path to the directory to calculate the size of
 * @returns A promise that resolves to the total size in bytes
 */
export function calculateDirectorySize( directoryPath: string ): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		let totalSize = 0;

		async function calculateSize( dirPath: string ): Promise< void > {
			try {
				const files = await fsPromises.readdir( dirPath, { withFileTypes: true } );

				await Promise.all(
					files.map( async ( file ) => {
						const filePath = path.join( dirPath, file.name );
						try {
							if ( file.isDirectory() ) {
								await calculateSize( filePath );
							} else {
								const stats = await fsPromises.stat( filePath );
								totalSize += stats.size;
							}
						} catch ( error ) {
							console.warn( `Error processing ${ filePath }:`, error );
						}
					} )
				);
			} catch ( error ) {
				throw new Error( `Failed to read directory ${ dirPath }: ${ error }` );
			}
		}

		calculateSize( directoryPath )
			.then( () => resolve( totalSize ) )
			.catch( reject );
	} );
}

export function isWordPressDirectory( projectPath: string ): boolean {
	return (
		fs.existsSync( path.join( projectPath, 'wp-content' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-includes' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-load.php' ) )
	);
}

// Compare paths in a case-insensitive manner. `fs.Stats.dev` signifies the device ID, and
// `fs.Stats.ino` signifies the inode number that uniquely identifies the file or directory.
// The benefit of this approach over converting the entire path to lowercase is that it respects
// the current file system's case sensitivity.
export function arePathsEqual( path1: string, path2: string ) {
	try {
		const stats1 = fs.statSync( path.resolve( path1 ) );
		const stats2 = fs.statSync( path.resolve( path2 ) );

		return stats1.ino === stats2.ino && stats1.dev === stats2.dev;
	} catch ( error ) {
		return false;
	}
}

export async function pathExists( path: string ): Promise< boolean > {
	try {
		await fsPromises.access( path );
		return true;
	} catch ( err: unknown ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return false;
		}
		throw err;
	}
}

export async function recursiveCopyDirectory(
	source: string,
	destination: string
): Promise< void > {
	await fsPromises.mkdir( destination, { recursive: true } );

	const entries = await fsPromises.readdir( source, { withFileTypes: true } );

	for ( const entry of entries ) {
		const sourcePath = path.join( source, entry.name );
		const destinationPath = path.join( destination, entry.name );

		if ( entry.isDirectory() ) {
			await recursiveCopyDirectory( sourcePath, destinationPath );
		} else if ( entry.isFile() ) {
			await fsPromises.copyFile( sourcePath, destinationPath );
		}
	}
}

export async function isEmptyDir( directory: string ): Promise< boolean > {
	const stats = await fsPromises.stat( directory );
	if ( ! stats.isDirectory() ) {
		return false;
	}
	const files = await fsPromises.readdir( directory );
	return files.length === 0;
}
