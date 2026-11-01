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
import { existsSync, readdirSync, readFileSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import {
	isBlockTheme,
	isUpdatableTheme,
	namesakeProblem,
	readThemeHeader,
	wordPressOrgNamesake,
} from '@studio/agent/node/themes';
import type { ChangeReport, SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

const BASE = 'base ';
const UPDATED = 'updated ';

const hashOf = ( version?: string ) => version?.split( ' ' )[ 1 ] ?? '';

async function readFiles( dir: string, slug: string, last: Versions ): Promise< Versions > {
	const entries = ( await readdir( dir, { recursive: true, withFileTypes: true } ) ).filter(
		( entry ) => entry.isFile()
	);
	const versions = await Promise.all(
		entries.map( async ( entry ) => {
			const file = path.join( entry.parentPath, entry.name );
			const key = `${ slug }/${ path.relative( dir, file ).split( path.sep ).join( '/' ) }`;
			const { mtimeMs, size } = await stat( file );
			const stamp = `${ mtimeMs }:${ size }`;
			const known = last[ key ]?.startsWith( `${ stamp } ` ) ? hashOf( last[ key ] ) : undefined;
			const hash =
				known ??
				createHash( 'sha1' )
					.update( await readFile( file ) )
					.digest( 'hex' );
			return [ key, `${ stamp } ${ hash }` ] as const;
		} )
	);
	return Object.fromEntries( versions );
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
	const blockTheme = isBlockTheme( themeDir );
	if ( file.endsWith( '.css' ) || file === 'theme.json' || file.startsWith( 'styles/' ) ) {
		return blockTheme
			? `the site's Global Styles for ${ slug }, as the Site Editor's Styles panel saves them: the wp_global_styles post whose JSON WordPress merges over the theme's theme.json, with CSS in its styles.css (WP_Theme_JSON_Resolver::get_user_global_styles_post_id() and get_merged_data() in wp-includes/class-wp-theme-json-resolver.php)`
			: `the site's Additional CSS, as the Customizer saves it (wp_update_custom_css_post() in wp-includes/theme.php)`;
	}
	const template = ( which: string ) =>
		`a template saved for ${ slug }, as the Site Editor saves one it customizes: a wp_template or wp_template_part post with the wp_theme term ${ slug }${ which }, which WordPress serves in place of the theme's file (get_block_templates() in wp-includes/block-template-utils.php)`;
	if ( blockTheme && /^(templates|parts)\/[^/]+\.html$/.test( file ) ) {
		return template( '' );
	}
	const usedBy = blockTheme ? templatesUsingPattern( themeDir, file ) : [];
	if ( usedBy.length ) {
		return template(
			` for ${ usedBy.join( ', ' ) }, which ${
				usedBy.length === 1 ? 'shows' : 'show'
			} this pattern through a Pattern block; the saved one holds the pattern's blocks in its place (render_block_core_pattern() in wp-includes/blocks/pattern.php)`
		);
	}
	return `a child theme of ${ slug }, whose style.css names \`Template: ${ slug }\``;
}

/** The place for any change to an updatable theme: a child theme of the site's own. */
export const ownThemeHome = ( slug: string ) =>
	`a child theme of ${ slug }, which scaffold_theme makes and activates; WordPress reads each file the child lacks from ${ slug } and merges the child's theme.json over ${ slug }'s`;

/** Where else than a child theme WordPress keeps a change, as a sentence, or nothing. */
export const otherHome = ( slug: string, home: string, them: string ) =>
	home.startsWith( `a child theme of ${ slug },` ) ? '' : ` Or make ${ them } in ${ home }.`;

// The theme's templates and parts that show a pattern of its own, by the
// pattern's Slug header (as _register_theme_block_patterns() reads it, in
// wp-includes/block-patterns.php).
function templatesUsingPattern( themeDir: string, file: string ): string[] {
	const pattern = path.join( themeDir, file );
	if ( ! /^patterns\/[^/]+\.php$/.test( file ) || ! existsSync( pattern ) ) {
		return [];
	}
	const source = readFileSync( pattern, 'utf8' );
	const patternSlug = source.match( /^[ \t/*#@]*Slug:(.*)$/m )?.[ 1 ].trim();
	if ( ! patternSlug ) {
		return [];
	}
	const block = new RegExp(
		`<!--\\s+wp:pattern\\s+\\{[^}]*"slug":"${ patternSlug.replace(
			/[.*+?^${}()|[\]\\/]/g,
			'\\$&'
		) }"`
	);
	return [ 'templates', 'parts' ].flatMap( ( dir ) =>
		( existsSync( path.join( themeDir, dir ) ) ? readdirSync( path.join( themeDir, dir ) ) : [] )
			.filter( ( name ) => name.endsWith( '.html' ) )
			.map( ( name ) => `${ dir }/${ name }` )
			.filter( ( name ) => block.test( readFileSync( path.join( themeDir, name ), 'utf8' ) ) )
	);
}

const listed = ( files: string[] ) =>
	files.length > 5 ? `${ files.slice( 0, 5 ).join( ', ' ) }, …` : files.join( ', ' );

function problem( themeDir: string, slug: string, files: string[], removed: string[] ): string {
	const restore = `restore ${ slug }'s released files, as \`wp theme install ${ slug } --force\` does for a theme from WordPress.org.`;
	// A released file that is gone is back with the next update.
	const gone = removed.length
		? `${ listed( removed ) } of ${ slug }'s release ${
				removed.length === 1 ? 'is' : 'are'
		  } gone, and an update brings ${ removed.length === 1 ? 'it' : 'them' } back. `
		: '';
	if ( ! files.length ) {
		return `${ slug } is a theme WordPress updates: ${ gone }To keep ${ slug } as released, ${ restore }`;
	}
	const named = listed( files );
	const homes = new Map< string, string[] >();
	for ( const file of files ) {
		const home = updatableThemeChangeHome( themeDir, slug, file );
		homes.set( home, [ ...( homes.get( home ) ?? [] ), file ] );
	}
	// Where else WordPress saves each kind of change; a child theme holds them all.
	const elsewhere = [ ...homes ].filter( ( [ home ] ) => otherHome( slug, home, '' ) );
	const others = elsewhere.length
		? ` Or make ${ elsewhere
				.map( ( [ home, kept ] ) =>
					homes.size === 1 ? `them in ${ home }` : `${ listed( kept ) } in ${ home }`
				)
				.join( '; ' ) }.`
		: '';
	return `${ slug } is a theme WordPress updates, and an update replaces its files, so it loses the changes to ${ named }. ${ gone }Make them in ${ ownThemeHome(
		slug
	) }.${ others } Then ${ restore }`;
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
			// A release is its version and update source, as WordPress's check sends them.
			const release = (
				await Promise.all(
					[ 'Version', 'Update URI' ].map( ( header ) =>
						readThemeHeader( sitePath, slug, header ).catch( () => '' )
					)
				)
			).join( ' ' );
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
		const reports: ChangeReport[] = [];
		const themes = ( versions: Versions ) =>
			Object.keys( versions ).filter( ( key ) => ! key.includes( '/' ) );
		// A theme WordPress no longer updates, or gone, leaves no problem.
		for ( const slug of themes( before ) ) {
			if ( before[ slug ].startsWith( UPDATED ) && ! after[ slug ]?.startsWith( UPDATED ) ) {
				reports.push( { key: `theme ${ slug }` } );
			}
		}
		for ( const slug of themes( after ) ) {
			const release = after[ slug ];
			if ( ! release.startsWith( UPDATED ) ) {
				continue;
			}
			// One whose folder name is WordPress.org's other theme is not WordPress.org's release.
			const namesake = await wordPressOrgNamesake( site.path, slug );
			if ( namesake ) {
				// Raised as it becomes one, as a call makes it.
				if ( before[ slug ] !== release ) {
					reports.push( { key: `theme ${ slug }`, problem: namesakeProblem( slug, namesake ) } );
				}
				continue;
			}
			// Files of one this call installed or updated are not reported.
			if ( before[ slug ] !== release ) {
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
			const removed: string[] = [];
			for ( const file of files ) {
				const now = hashOf( after[ file ] );
				const was = hashOf( before[ file ] );
				const base = before[ `${ BASE }${ file }` ] ?? was;
				changed ||= now !== was;
				if ( now !== base ) {
					next[ `${ BASE }${ file }` ] = base;
					( now ? changes : removed ).push( file.slice( prefix.length ) );
				}
			}
			if ( changed ) {
				reports.push( {
					key: `theme ${ slug }`,
					problem:
						changes.length || removed.length
							? problem(
									path.join( site.path, 'wp-content', 'themes', slug ),
									slug,
									changes,
									removed
							  )
							: undefined,
				} );
			}
		}
		return { reports, next };
	},
};
