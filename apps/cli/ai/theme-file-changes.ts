/**
 * Changes to the files of a theme WordPress updates, by any tool or script. An
 * update replaces the theme's folder with its new release
 * (Theme_Upgrader::upgrade() in wp-admin/includes/class-theme-upgrader.php),
 * so the changes are lost. WordPress keeps each kind of change elsewhere, as
 * its own screens save it (updatableThemeChangeHome()).
 *
 * Each file's version is its modified time, size and content hash, the hash
 * read again only when the time or size moves. A theme installed or updated
 * by the call is WordPress's own write, and its files are what later calls are
 * compared with.
 */
import { createHash } from 'crypto';
import { existsSync } from 'fs';
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

/**
 * Where WordPress keeps a change to `file` of the updatable theme `slug` in
 * `themeDir`, as its own screens save it: a block theme's styles in the
 * site's Global Styles, which the Site Editor's Styles panel saves; its
 * templates in a template saved for the theme, as the Site Editor saves one
 * it customizes; a classic theme's CSS in the Customizer's Additional CSS;
 * and the theme's code in a child theme.
 */
export function updatableThemeChangeHome( themeDir: string, slug: string, file: string ): string {
	const blockTheme = existsSync( path.join( themeDir, 'theme.json' ) );
	if ( file.endsWith( '.css' ) || file === 'theme.json' || file.startsWith( 'styles/' ) ) {
		return blockTheme
			? `the site's Global Styles for ${ slug }, as the Site Editor's Styles panel saves them: the wp_global_styles post whose JSON WordPress merges over the theme's theme.json, with CSS in its styles.css (WP_Theme_JSON_Resolver::get_user_global_styles_post_id() and get_merged_data() in wp-includes/class-wp-theme-json-resolver.php)`
			: `the site's Additional CSS, as the Customizer saves it (wp_update_custom_css_post() in wp-includes/theme.php)`;
	}
	if ( blockTheme && /^(templates|parts)\/[^/]+\.html$/.test( file ) ) {
		return `a template saved for ${ slug }, as the Site Editor saves one it customizes: a wp_template or wp_template_part post with the wp_theme term ${ slug }, which WordPress serves in place of the theme's file (get_block_templates() in wp-includes/block-template-utils.php)`;
	}
	return `a child theme of ${ slug }, whose style.css names \`Template: ${ slug }\`; it takes effect once the site switches to it, which is the user's choice of theme`;
}

function problem( themeDir: string, slug: string, files: string[] ): string {
	const named = files.length > 5 ? `${ files.slice( 0, 5 ).join( ', ' ) }, …` : files.join( ', ' );
	const homes = new Map< string, string[] >();
	for ( const file of files ) {
		const home = updatableThemeChangeHome( themeDir, slug, file );
		homes.set( home, [ ...( homes.get( home ) ?? [] ), file ] );
	}
	const where = [ ...homes ]
		.map( ( [ home, kept ] ) =>
			homes.size === 1 ? home : `${ kept.slice( 0, 5 ).join( ', ' ) } in ${ home }`
		)
		.join( '; ' );
	return `${ slug } is a theme WordPress updates, and an update replaces its files, so it loses the changes to ${ named }. Make ${
		homes.size === 1 ? 'them in ' : 'each where WordPress saves that kind of change: '
	}${ where }. Then restore ${ slug }'s released files, as \`wp theme install ${ slug } --force\` does for a theme from WordPress.org.`;
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
	async check( site, before, after ) {
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
					problem: changes.length
						? problem( path.join( site.path, 'wp-content', 'themes', slug ), slug, changes )
						: undefined,
				} );
			}
		}
		return { reports, next };
	},
};
