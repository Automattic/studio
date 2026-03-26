import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import { isErrnoException } from './is-errno-exception';
import type { Ignore } from './deploy-ignore';

const DEFAULT_EXCLUDED_DIRECTORIES = [ '.git', 'node_modules' ];

/**
 * Calculates the total size of a directory by recursively traversing its contents.
 * When a deploy-ignore filter is provided, uses it to determine which files to exclude.
 * Otherwise, falls back to excluding .git and node_modules directories.
 *
 * @param directoryPath - The path to the directory to calculate the size of
 * @param deployIgnore - Optional Ignore instance from createDeployIgnoreFilter
 * @param pathPrefix - Optional prefix for relative paths when matching against deployIgnore
 *                     (e.g., 'wp-content' when scanning the wp-content directory)
 * @returns A promise that resolves to the total size in bytes
 */
export function calculateDirectorySizeForArchive(
	directoryPath: string,
	deployIgnore?: Ignore,
	pathPrefix?: string
): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		let totalSize = 0;

		async function calculateSize( dirPath: string, relativePath: string ): Promise< void > {
			try {
				const files = await fsPromises.readdir( dirPath, { withFileTypes: true } );

				await Promise.all(
					files.map( async ( file ) => {
						const filePath = path.join( dirPath, file.name );
						const fileRelativePath = relativePath ? `${ relativePath }/${ file.name }` : file.name;
						try {
							if ( deployIgnore ) {
								const ignorePath = pathPrefix
									? `${ pathPrefix }/${ fileRelativePath }`
									: fileRelativePath;
								if ( deployIgnore.ignores( ignorePath ) ) {
									return;
								}
							} else if (
								file.isDirectory() &&
								DEFAULT_EXCLUDED_DIRECTORIES.includes( file.name )
							) {
								return;
							}
							if ( file.isDirectory() ) {
								await calculateSize( filePath, fileRelativePath );
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

		calculateSize( directoryPath, '' )
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

// Compare paths, preferring inode comparison when both paths exist on disk.
// `fs.Stats.dev` signifies the device ID, and `fs.Stats.ino` signifies the inode number
// that uniquely identifies the file or directory. This approach respects the current file
// system's case sensitivity.
// Falls back to string comparison when either path doesn't exist (e.g., deleted directories).
export function arePathsEqual( path1: string, path2: string ) {
	try {
		const stats1 = fs.statSync( path.resolve( path1 ) );
		const stats2 = fs.statSync( path.resolve( path2 ) );

		return stats1.ino === stats2.ino && stats1.dev === stats2.dev;
	} catch ( error ) {
		return path.resolve( path1 ) === path.resolve( path2 );
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

	await Promise.all(
		entries.map( ( entry ) => {
			const sourcePath = path.join( source, entry.name );
			const destinationPath = path.join( destination, entry.name );

			if ( entry.isDirectory() ) {
				return recursiveCopyDirectory( sourcePath, destinationPath );
			}
			if ( entry.isFile() ) {
				return fsPromises.copyFile( sourcePath, destinationPath );
			}
		} )
	);
}

export async function isEmptyDir( directory: string ): Promise< boolean > {
	const stats = await fsPromises.stat( directory );
	if ( ! stats.isDirectory() ) {
		return false;
	}
	const files = await fsPromises.readdir( directory );
	return files.length === 0;
}
