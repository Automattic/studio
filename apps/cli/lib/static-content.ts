import fs from 'fs';
import path from 'path';
import { runCommand as exportStaticSite } from 'cli/commands/export-static';
import type { PushContent, PushFile } from '@studio/providers';

// Files served from the root of the site. WordPress never serves them, so the static export
// can't crawl them; a site that needs redirects, headers, a robots.txt or an llms.txt keeps them
// at its root and they are published as they are.
const ROOT_FILES = [ '_redirects', '_headers', 'robots.txt', 'llms.txt' ];

// A static export of the site for a push, written to `outputDir`, with links to `destinationUrl`.
export async function exportStaticContent(
	sitePath: string,
	destinationUrl: string,
	outputDir: string,
	beforeExport?: () => Promise< void >
): Promise< PushContent > {
	await exportStaticSite( sitePath, outputDir, destinationUrl, true, beforeExport );
	for ( const name of ROOT_FILES ) {
		try {
			await fs.promises.copyFile( path.join( sitePath, name ), path.join( outputDir, name ) );
		} catch ( error ) {
			if ( ( error as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
				throw error;
			}
		}
	}
	return { kind: 'files', files: await listFiles( outputDir ) };
}

async function listFiles( directory: string ): Promise< PushFile[] > {
	const entries = await fs.promises.readdir( directory, { recursive: true, withFileTypes: true } );
	return Promise.all(
		entries
			.filter( ( entry ) => entry.isFile() )
			.map( async ( entry ) => {
				const absolute = path.join( entry.parentPath, entry.name );
				return {
					path: path.relative( directory, absolute ).split( path.sep ).join( '/' ),
					size: ( await fs.promises.stat( absolute ) ).size,
					read: () => fs.promises.readFile( absolute ),
				};
			} )
	);
}
