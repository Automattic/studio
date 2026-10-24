/**
 * The theme and scratch files of a site that a call wrote, by any tool, shell
 * command or script, so each gets the write notes a file tool's write gets
 * (site-notes.ts): fonts self-hosted, block markup validated, theme.json and
 * theme CSS checked. Each file's version is its modified time and size.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';

// The folders of a site whose files the write notes are about.
const NOTED_FOLDERS = [ path.join( 'wp-content', 'themes' ), 'tmp' ];
const SKIPPED_FOLDERS = new Set( [ 'node_modules', '.git' ] );

export const siteFileWrites: SiteChangeSource = {
	name: 'files',
	async read( sitePath ) {
		const versions: Versions = {};
		for ( const folder of NOTED_FOLDERS.map( ( noted ) => path.join( sitePath, noted ) ) ) {
			const entries = await readdir( folder, { recursive: true, withFileTypes: true } ).catch(
				() => []
			);
			for ( const entry of entries ) {
				const file = path.join( entry.parentPath, entry.name );
				if (
					entry.isFile() &&
					! path
						.relative( folder, file )
						.split( path.sep )
						.some( ( part ) => SKIPPED_FOLDERS.has( part ) )
				) {
					const { mtimeMs, size } = await stat( file ).catch( () => ( { mtimeMs: 0, size: -1 } ) );
					versions[ file ] = `${ mtimeMs }:${ size }`;
				}
			}
		}
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
