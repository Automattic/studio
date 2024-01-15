import { promises as fs } from 'fs';
import path from 'path';

export async function pathExists( path: string ): Promise< boolean > {
	try {
		await fs.access( path );
		return true;
	} catch ( err: any ) {
		if ( err && 'code' in err && err.code === 'ENOENT' ) {
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
