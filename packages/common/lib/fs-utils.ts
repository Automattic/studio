import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import ignore, { Ignore } from 'ignore';
import { DEPLOY_IGNORE_DEFAULTS } from './deploy-ignore-defaults';
import { isErrnoException } from './is-errno-exception';

/**
 * Calculates the total size of a directory by recursively traversing its contents.
 * Uses the provided deploy-ignore filter to determine which files to exclude,
 * or falls back to a default filter seeded with DEPLOY_IGNORE_DEFAULTS.
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
	const ig = deployIgnore ?? ignore().add( DEPLOY_IGNORE_DEFAULTS );

	return new Promise( ( resolve, reject ) => {
		let totalSize = 0;

		async function calculateSize( dirPath: string ): Promise< void > {
			try {
				const files = await fsPromises.readdir( dirPath, { withFileTypes: true } );

				await Promise.all(
					files.map( async ( file ) => {
						const filePath = path.join( dirPath, file.name );
						const fileRelativeToRoot = path.relative( directoryPath, filePath );
						const ignorePath = pathPrefix
							? path.join( pathPrefix, fileRelativeToRoot )
							: fileRelativeToRoot;
						try {
							if ( ig.ignores( ignorePath ) ) {
								return;
							}
							if ( file.isDirectory() ) {
								await calculateSize( filePath );
							} else {
								const stats = await fsPromises.stat( filePath );
								totalSize += stats.size;
							}
						} catch ( error ) {
							// Dangling symlink or unreadable entry. Skip it (uncounted)
							// rather than failing the size calculation.
							console.warn( `Skipping ${ filePath }: ${ error }` );
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

// The source may be mutated while copying (e.g. duplicating a running site whose
// SQLite journal and cache files come and go), so entries that disappear between
// enumeration and copy are skipped rather than failing the whole copy. A missing
// top-level source still throws.
export async function recursiveCopyDirectory(
	source: string,
	destination: string
): Promise< void > {
	const entries = await fsPromises.readdir( source, { withFileTypes: true } );

	await fsPromises.mkdir( destination, { recursive: true } );

	await Promise.all(
		entries.map( async ( entry ) => {
			const sourcePath = path.join( source, entry.name );
			const destinationPath = path.join( destination, entry.name );

			try {
				if ( entry.isDirectory() ) {
					await recursiveCopyDirectory( sourcePath, destinationPath );
				} else if ( entry.isFile() ) {
					await fsPromises.cp( sourcePath, destinationPath, {
						mode: fs.constants.COPYFILE_FICLONE,
						preserveTimestamps: true,
					} );
				}
			} catch ( error ) {
				if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
					return;
				}
				throw error;
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

export function readLastLines( filePath: string, maxLines: number ): string[] | undefined {
	try {
		if ( ! fs.existsSync( filePath ) ) {
			return undefined;
		}
		const content = fs.readFileSync( filePath, 'utf-8' );
		const lines = content.split( '\n' ).filter( ( line ) => line.trim() );
		return lines.slice( -maxLines );
	} catch {
		return undefined;
	}
}
