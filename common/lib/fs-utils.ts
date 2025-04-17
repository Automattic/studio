import fs from 'fs';
import path from 'path';
import { existsSync } from 'fs-extra';

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
				const files = await fs.promises.readdir( dirPath, { withFileTypes: true } );

				await Promise.all(
					files.map( async ( file ) => {
						const filePath = path.join( dirPath, file.name );
						try {
							if ( file.isDirectory() ) {
								await calculateSize( filePath );
							} else {
								const stats = await fs.promises.stat( filePath );
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
		existsSync( path.join( projectPath, 'wp-content' ) ) &&
		existsSync( path.join( projectPath, 'wp-includes' ) ) &&
		existsSync( path.join( projectPath, 'wp-load.php' ) )
	);
}
