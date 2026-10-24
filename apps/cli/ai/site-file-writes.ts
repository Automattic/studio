/**
 * The files of a site that a call wrote, by any tool, shell command or script,
 * so each gets the write notes a file tool's write gets (site-notes.ts): fonts
 * self-hosted, block markup validated wherever a draft is written, theme.json
 * and theme CSS checked. Each file's version is its modified time and size.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';

// What holds no file the write notes are about: WordPress core, which Studio
// refuses writes to, the site's database, plugin code, and the dependencies
// and history of a project in the site.
const UNNOTED = new Set( [
	'wp-admin',
	'wp-includes',
	path.join( 'wp-content', 'database' ),
	path.join( 'wp-content', 'plugins' ),
	path.join( 'wp-content', 'mu-plugins' ),
] );
const UNNOTED_NAMES = new Set( [ 'node_modules', '.git' ] );

async function walk( root: string, folder: string, versions: Versions ): Promise< void > {
	const entries = await readdir( path.join( root, folder ), { withFileTypes: true } ).catch(
		() => []
	);
	await Promise.all(
		entries.map( async ( entry ) => {
			const relative = path.join( folder, entry.name );
			if ( entry.isDirectory() ) {
				if ( ! UNNOTED.has( relative ) && ! UNNOTED_NAMES.has( entry.name ) ) {
					await walk( root, relative, versions );
				}
			} else if ( entry.isFile() ) {
				const file = path.join( root, relative );
				const { mtimeMs, size } = await stat( file ).catch( () => ( { mtimeMs: 0, size: -1 } ) );
				versions[ file ] = `${ mtimeMs }:${ size }`;
			}
		} )
	);
}

export const siteFileWrites: SiteChangeSource = {
	name: 'files',
	async read( sitePath ) {
		const versions: Versions = {};
		await walk( sitePath, '', versions );
		return versions;
	},
	async check( _site, before, after ) {
		return {
			reports: Object.entries( after )
				.filter( ( [ file, version ] ) => before[ file ] !== version )
				.map( ( [ file ] ) => ( { key: `file ${ file }`, written: file } ) ),
		};
	},
};
