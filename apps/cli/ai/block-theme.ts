/**
 * Whether a theme made during the session is a block theme, as WordPress's
 * default theme is. WordPress treats a theme as a block theme when it has
 * templates/index.html (WP_Theme::is_block_theme() in
 * wp-includes/class-wp-theme.php), and only a block theme's templates, parts
 * and styles are edited in the Site Editor, around page content that is blocks.
 *
 * A theme the site already had keeps the kind it is. One made during the
 * session that is classic, or that WordPress lists as broken for having
 * neither index yet, stays an open problem while it is.
 */
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { readThemeHeader, isUpdatableTheme } from 'cli/ai/themes';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';

const CREATED = 'created:';
const exists = ( file: string ) => stat( file ).then( Boolean, () => false );

/**
 * A standalone theme's kind: block, with a block template index
 * (WP_Theme::is_block_theme()); classic, with PHP templates at its root
 * instead, as index.php, header.php or page.php are, which WordPress's
 * default theme has none of. Its one root PHP file is functions.php, which
 * WordPress loads for every theme (wp-settings.php). A child theme is its
 * parent's kind, so it is left to its parent.
 */
async function themeKind( root: string, theme: string ): Promise< string > {
	const dir = path.join( root, 'wp-content', 'themes', theme );
	if ( await readThemeHeader( root, theme, 'Template' ).catch( () => '' ) ) {
		return 'child';
	}
	if ( await exists( path.join( dir, 'templates/index.html' ) ) ) {
		return 'block';
	}
	return ( await rootTemplates( dir ) ).length ? 'classic' : 'unfinished';
}

async function rootTemplates( dir: string ): Promise< string[] > {
	const files = await readdir( dir ).catch( () => [] as string[] );
	return files.filter( ( file ) => file.endsWith( '.php' ) && file !== 'functions.php' ).sort();
}

/** WP_DEFAULT_THEME, the theme core falls back to (wp-includes/default-constants.php). */
async function defaultTheme( root: string ): Promise< string | undefined > {
	const php = await readFile(
		path.join( root, 'wp-includes/default-constants.php' ),
		'utf8'
	).catch( () => '' );
	return php.match( /define\(\s*'WP_DEFAULT_THEME',\s*'([^']+)'/ )?.[ 1 ];
}

async function classicThemeProblem( root: string, theme: string ): Promise< string > {
	const templates = await rootTemplates( path.join( root, 'wp-content', 'themes', theme ) );
	const fallback = await defaultTheme( root );
	const named = fallback ? `, ${ fallback } (WP_DEFAULT_THEME),` : '';
	return `${ theme } (wp-content/themes/${ theme }), made this session, is becoming a classic theme: its PHP templates (${ templates.join(
		', '
	) }) and what they write are edited only in code. WordPress treats a theme as a block theme when it has templates/index.html (WP_Theme::is_block_theme() in wp-includes/class-wp-theme.php); then the Site Editor edits its templates, parts and styles, and the block editor each page's content. WordPress's default theme${ named } is a block theme: its templates are block markup in templates/*.html, its parts in parts/*.html, and its one PHP file at the root is functions.php. Write ${ theme }'s templates and parts that way, with each page's content in the page as blocks, in place of its PHP templates.`;
}

// A theme WordPress reports broken, with neither index (WP_Theme::__construct()).
async function missingTemplateProblem( root: string, theme: string ): Promise< string > {
	const fallback = await defaultTheme( root );
	const named = fallback ? `, ${ fallback } (WP_DEFAULT_THEME),` : '';
	return `${ theme } (wp-content/themes/${ theme }), made this session, has neither templates/index.html nor index.php, so WordPress lists it as broken: "Template is missing. Standalone themes need to have a templates/index.html or index.php template file." (WP_Theme::__construct() in wp-includes/class-wp-theme.php). WordPress's default theme${ named } is a block theme with templates/index.html. Give ${ theme } its templates/index.html.`;
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
			const kind = next[ theme ].slice( CREATED.length );
			const problem = {
				classic: classicThemeProblem,
				unfinished: missingTemplateProblem,
			}[ kind ];
			reports.push( {
				key: `block theme ${ theme }`,
				problem:
					problem && ! ( await isUpdatableTheme( site.path, theme ) )
						? await problem( site.path, theme )
						: undefined,
				atTurnEnd: kind === 'unfinished',
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
