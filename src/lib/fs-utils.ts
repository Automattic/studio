import { promises as fs } from 'fs';
import path from 'path';
import { existsSync } from 'fs-extra';
import { isErrnoException } from './is-errno-exception';

export async function pathExists( path: string ): Promise< boolean > {
	try {
		await fs.access( path );
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
	await fs.mkdir( destination, { recursive: true } );

	const entries = await fs.readdir( source, { withFileTypes: true } );

	for ( const entry of entries ) {
		const sourcePath = path.join( source, entry.name );
		const destinationPath = path.join( destination, entry.name );

		if ( entry.isDirectory() ) {
			await recursiveCopyDirectory( sourcePath, destinationPath );
		} else if ( entry.isFile() ) {
			await fs.copyFile( sourcePath, destinationPath );
		}
	}
}

export async function isEmptyDir( directory: string ): Promise< boolean > {
	const stats = await fs.stat( directory );
	if ( ! stats.isDirectory() ) {
		return false;
	}
	const files = await fs.readdir( directory );
	return files.length === 0;
}

export function isWordPressDirectory( projectPath: string ): boolean {
	return (
		existsSync( path.join( projectPath, 'wp-content' ) ) &&
		existsSync( path.join( projectPath, 'wp-includes' ) ) &&
		existsSync( path.join( projectPath, 'wp-load.php' ) )
	);
}
