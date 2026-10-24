/**
 * Whether a theme made during the session is a block theme, as WordPress's
 * default theme is. WordPress treats a theme as a block theme when it has
 * templates/index.html (WP_Theme::is_block_theme() in
 * wp-includes/class-wp-theme.php), and only a block theme's templates, parts
 * and styles are edited in the Site Editor, around page content that is blocks.
 *
 * A theme the site already had keeps the kind it is. One made during the
 * session that is classic stays an open problem while it is.
 */
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { readThemeHeader, isUpdatableTheme } from 'cli/ai/themes';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';

const CREATED = 'created:';
const exists = ( file: string ) => stat( file ).then( Boolean, () => false );

/**
 * A standalone theme's kind: block, with a block template index
 * (WP_Theme::is_block_theme()); classic, with the index.php a classic theme
 * needs instead (WP_Theme::__construct(), "Template is missing"). A child
 * theme is its parent's kind, so it is left to its parent.
 */
async function themeKind( root: string, theme: string ): Promise< string > {
	const dir = path.join( root, 'wp-content', 'themes', theme );
	if ( await readThemeHeader( root, theme, 'Template' ).catch( () => '' ) ) {
		return 'child';
	}
	for ( const [ kind, file ] of [
		[ 'block', 'templates/index.html' ],
		[ 'classic', 'index.php' ],
	] ) {
		if ( await exists( path.join( dir, file ) ) ) {
			return kind;
		}
	}
	return 'unfinished';
}

/** WP_DEFAULT_THEME, the theme core falls back to (wp-includes/default-constants.php). */
export async function defaultTheme( root: string ): Promise< string | undefined > {
	const php = await readFile(
		path.join( root, 'wp-includes/default-constants.php' ),
		'utf8'
	).catch( () => '' );
	return php.match( /define\(\s*'WP_DEFAULT_THEME',\s*'([^']+)'/ )?.[ 1 ];
}

async function classicThemeProblem( root: string, theme: string ): Promise< string > {
	const fallback = await defaultTheme( root );
	const named = fallback ? `, ${ fallback } (WP_DEFAULT_THEME),` : '';
	return `${ theme } (wp-content/themes/${ theme }), made this session, is a classic theme: WordPress treats a theme as a block theme when it has templates/index.html (WP_Theme::is_block_theme() in wp-includes/class-wp-theme.php), and only then does the Site Editor edit its templates, parts and styles, around page content that is blocks. WordPress's default theme${ named } is a block theme: its templates are block markup in templates/*.html and its parts in parts/*.html. Give ${ theme } its templates and parts that way, with each page's content in the page as blocks.`;
}

export const blockTheme: SiteChangeSource = {
	name: 'block-theme',
	async read( sitePath, last ) {
		const dir = path.join( sitePath, 'wp-content', 'themes' );
		const themes = await readdir( dir ).catch( () => [] as string[] );
		const versions: Versions = {};
		for ( const theme of themes ) {
			if ( ! ( await exists( path.join( dir, theme, 'style.css' ) ) ) ) {
				continue;
			}
			const kind = await themeKind( sitePath, theme );
			versions[ theme ] = ( last?.[ theme ]?.startsWith( CREATED ) ? CREATED : '' ) + kind;
		}
		return versions;
	},
	async check( site, before, after ) {
		const next: Versions = {};
		const reports = [];
		for ( const [ theme, version ] of Object.entries( after ) ) {
			const created = ! ( theme in before ) || version.startsWith( CREATED );
			next[ theme ] = created && ! version.startsWith( CREATED ) ? CREATED + version : version;
			if ( ! created || before[ theme ] === next[ theme ] ) {
				continue;
			}
			const classic = next[ theme ] === `${ CREATED }classic`;
			reports.push( {
				key: `block theme ${ theme }`,
				problem:
					classic && ! ( await isUpdatableTheme( site.path, theme ) )
						? await classicThemeProblem( site.path, theme )
						: undefined,
			} );
		}
		// A theme made this session and deleted since leaves no problem.
		for ( const theme of Object.keys( before ) ) {
			if ( before[ theme ].startsWith( CREATED ) && ! ( theme in after ) ) {
				reports.push( { key: `block theme ${ theme }`, problem: undefined } );
			}
		}
		return { reports, next };
	},
};
