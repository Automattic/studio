/**
 * Files a child theme holds unchanged from its parent, by any tool or script.
 * WordPress already reads a file the child lacks from the parent
 * (get_theme_file_path(), get_theme_file_uri() for theme.json's `file:./`
 * fonts, locate_template(), the block template and pattern resolvers) and merges the child's theme.json over the parent's
 * (WP_Theme_JSON_Resolver::get_theme_data()), so a copy only stops following
 * the parent's updates; both functions.php files load (wp-settings.php), so a
 * copied one redeclares the parent's functions. A child theme holds the files
 * it changes (https://developer.wordpress.org/themes/advanced-topics/child-themes/).
 *
 * A screenshot is the child's own: WP_Theme::get_screenshot() reads only the
 * child's folder.
 *
 * Each file's version is both files' modified time and size and whether their
 * content is the same, compared again only when a time or size moves.
 */
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { readThemeHeader } from 'cli/ai/themes';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';

const SCREENSHOT = /^screenshot\.(png|gif|jpe?g|webp|avif)$/;
const SAME = ' same';

const stampOf = async ( file: string ) => {
	const { mtimeMs, size } = await stat( file );
	return { stamp: `${ mtimeMs }:${ size }`, size };
};

async function readCopies(
	themesDir: string,
	child: string,
	parent: string,
	last: Versions
): Promise< Versions > {
	const versions: Versions = {};
	const childDir = path.join( themesDir, child );
	for ( const entry of await readdir( childDir, { recursive: true, withFileTypes: true } ) ) {
		const relative = path
			.relative( childDir, path.join( entry.parentPath, entry.name ) )
			.split( path.sep )
			.join( '/' );
		if ( ! entry.isFile() || SCREENSHOT.test( relative ) ) {
			continue;
		}
		const childFile = path.join( childDir, relative );
		const parentFile = path.join( themesDir, parent, relative );
		const [ own, inherited ] = await Promise.all( [
			stampOf( childFile ),
			stampOf( parentFile ).catch( () => undefined ),
		] );
		if ( ! inherited ) {
			continue;
		}
		const key = `${ child }/${ relative }`;
		const stamps = `${ own.stamp }|${ inherited.stamp }`;
		const same = last[ key ]?.startsWith( `${ stamps } ` )
			? last[ key ].endsWith( SAME )
			: own.size === inherited.size &&
			  ( await readFile( childFile ) ).equals( await readFile( parentFile ) );
		versions[ key ] = `${ stamps }${ same ? SAME : ' own' }`;
	}
	return versions;
}

const copiesOf = ( versions: Versions, child: string ) =>
	Object.entries( versions )
		.filter( ( [ key, version ] ) => key.startsWith( `${ child }/` ) && version.endsWith( SAME ) )
		.map( ( [ key ] ) => key.slice( child.length + 1 ) )
		.sort();

function problem( child: string, parent: string, files: string[] ): string {
	const named = files.length > 5 ? `${ files.slice( 0, 5 ).join( ', ' ) }, …` : files.join( ', ' );
	return `The child theme ${ child } holds files of its parent ${ parent } unchanged: ${ named }. WordPress reads a file the child lacks from the parent and merges the child's theme.json over the parent's, so a copy only stops following ${ parent }'s updates, and a copied functions.php loads beside the parent's. Delete the copies, so ${ child } holds only the files it changes (https://developer.wordpress.org/themes/advanced-topics/child-themes/).`;
}

export const childThemeCopies: SiteChangeSource = {
	name: 'child-themes',
	async read( sitePath, last = {} ) {
		const themesDir = path.join( sitePath, 'wp-content', 'themes' );
		const themes = ( await readdir( themesDir, { withFileTypes: true } ).catch( () => [] ) )
			.filter( ( entry ) => entry.isDirectory() )
			.map( ( entry ) => entry.name );
		const versions: Versions = {};
		for ( const child of themes ) {
			const parent = await readThemeHeader( sitePath, child, 'Template' ).catch( () => '' );
			if ( parent && parent !== child ) {
				versions[ child ] = parent;
				Object.assign( versions, await readCopies( themesDir, child, parent, last ) );
			}
		}
		return versions;
	},
	async check( _site, before, after ) {
		const reports = [];
		const children = new Set(
			[ ...Object.keys( before ), ...Object.keys( after ) ].filter(
				( key ) => ! key.includes( '/' )
			)
		);
		for ( const child of children ) {
			const was = copiesOf( before, child );
			const now = copiesOf( after, child );
			if ( was.join( '\n' ) !== now.join( '\n' ) ) {
				reports.push( {
					key: `child theme ${ child }`,
					problem: now.length ? problem( child, after[ child ], now ) : undefined,
				} );
			}
		}
		return { reports };
	},
};
