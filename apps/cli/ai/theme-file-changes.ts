/**
 * Changes to the files of a theme WordPress updates, by any tool or script. An
 * update replaces the theme's folder with its new release
 * (Theme_Upgrader::upgrade() in wp-admin/includes/class-theme-upgrader.php),
 * so the changes are lost; a child theme keeps them (site-changes.ts).
 *
 * Each file's version is its modified time, size and content hash, the hash
 * read again only when the time or size moves. A theme installed or updated
 * by the call is WordPress's own write, and its files are what later calls are
 * compared with.
 */
import { createHash } from 'crypto';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { isUpdatableTheme, readThemeVersion } from 'cli/ai/themes';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';

const BASE = 'base ';
const UPDATED = 'updated ';

const hashOf = ( version?: string ) => version?.split( ' ' )[ 1 ] ?? '';

async function readFiles( dir: string, slug: string, last: Versions ): Promise< Versions > {
	const versions: Versions = {};
	for ( const entry of await readdir( dir, { recursive: true, withFileTypes: true } ) ) {
		if ( ! entry.isFile() ) {
			continue;
		}
		const file = path.join( entry.parentPath, entry.name );
		const key = `${ slug }/${ path.relative( dir, file ).split( path.sep ).join( '/' ) }`;
		const { mtimeMs, size } = await stat( file );
		const stamp = `${ mtimeMs }:${ size }`;
		const known = last[ key ]?.startsWith( `${ stamp } ` ) ? hashOf( last[ key ] ) : undefined;
		versions[ key ] = `${ stamp } ${
			known ??
			createHash( 'sha1' )
				.update( await readFile( file ) )
				.digest( 'hex' )
		}`;
	}
	return versions;
}

function problem( slug: string, files: string[] ): string {
	const named = files.length > 5 ? `${ files.slice( 0, 5 ).join( ', ' ) }, …` : files.join( ', ' );
	return `${ slug } is a theme WordPress updates, and an update replaces its files, so it loses the changes to ${ named }. Make them in a child theme of ${ slug }, whose style.css names \`Template: ${ slug }\`, then restore ${ slug }'s released files, as \`wp theme install ${ slug } --force\` does for a theme from WordPress.org.`;
}

export const updatableThemeChanges: SiteChangeSource = {
	name: 'themes',
	async read( sitePath, last = {} ) {
		const themesDir = path.join( sitePath, 'wp-content', 'themes' );
		const slugs = ( await readdir( themesDir, { withFileTypes: true } ).catch( () => [] ) )
			.filter( ( entry ) => entry.isDirectory() )
			.map( ( entry ) => entry.name );
		const versions: Versions = {};
		for ( const slug of slugs ) {
			const release = await readThemeVersion( sitePath, slug ).catch( () => '' );
			// Whether WordPress updates a theme is asked once per release.
			const updated = last[ slug ]?.endsWith( ` ${ release }` )
				? last[ slug ].startsWith( UPDATED )
				: await isUpdatableTheme( sitePath, slug );
			versions[ slug ] = `${ updated ? UPDATED : 'own ' }${ release }`;
			if ( updated ) {
				Object.assign( versions, await readFiles( path.join( themesDir, slug ), slug, last ) );
			}
			// The released files a call changed, kept while that release is installed.
			if ( updated && last[ slug ] === versions[ slug ] ) {
				for ( const [ key, base ] of Object.entries( last ) ) {
					if ( key.startsWith( `${ BASE }${ slug }/` ) ) {
						versions[ key ] = base;
					}
				}
			}
		}
		return versions;
	},
	async check( _site, before, after ) {
		const next: Versions = { ...after };
		for ( const key of Object.keys( next ) ) {
			if ( key.startsWith( BASE ) ) {
				delete next[ key ];
			}
		}
		const reports = [];
		for ( const [ slug, release ] of Object.entries( after ) ) {
			// Files of an own theme, or of one this call installed or updated, are not reported.
			if ( ! release.startsWith( UPDATED ) || before[ slug ] !== release ) {
				continue;
			}
			const prefix = `${ slug }/`;
			const files = new Set(
				[ ...Object.keys( before ), ...Object.keys( after ) ]
					.map( ( key ) => ( key.startsWith( BASE ) ? key.slice( BASE.length ) : key ) )
					.filter( ( key ) => key.startsWith( prefix ) )
			);
			let changed = false;
			const changes: string[] = [];
			for ( const file of files ) {
				const now = hashOf( after[ file ] );
				const was = hashOf( before[ file ] );
				const base = before[ `${ BASE }${ file }` ] ?? was;
				changed ||= now !== was;
				if ( now !== base ) {
					next[ `${ BASE }${ file }` ] = base;
					changes.push( file.slice( prefix.length ) );
				}
			}
			if ( changed ) {
				reports.push( {
					key: `theme ${ slug }`,
					problem: changes.length ? problem( slug, changes ) : undefined,
				} );
			}
		}
		return { reports, next };
	},
};
