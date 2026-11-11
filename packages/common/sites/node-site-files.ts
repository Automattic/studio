import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SiteFiles } from './site-design';

// A native site's files, in its folder on disk.
export function nodeSiteFiles( sitePath: string ): SiteFiles {
	return {
		read: ( file ) => readFile( path.join( sitePath, file ), 'utf8' ).catch( () => null ),
		async write( file, data ) {
			const target = path.join( sitePath, file );
			await mkdir( path.dirname( target ), { recursive: true } );
			await writeFile( target, data );
		},
	};
}
