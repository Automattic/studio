/**
 * Whether a theme made during the session is a block theme, as WordPress's
 * default theme is. WordPress treats a theme as a block theme when it has
 * templates/index.html (WP_Theme::is_block_theme() in
 * wp-includes/class-wp-theme.php), and only a block theme's templates, parts
 * and styles are edited in the Site Editor, around page content that is blocks.
 *
 * A theme the site already had keeps the kind it is. One made during the
 * session is classic only when the user chooses it, asked before the write
 * that starts it (classicThemeQuestion); one that WordPress lists as broken
 * for having neither index yet stays an open problem while it is.
 */
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { resolveSiteFile } from '@studio/agent/node/site-file-guards';
import { readThemeHeader, isUpdatableTheme } from '@studio/agent/node/themes';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

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

/**
 * The question a write that starts a classic theme asks the user first: a
 * root PHP template, such as index.php, header.php or page.php, in a theme
 * made without one, with no block template index. A classic theme is the
 * user's choice: its templates are edited only in code. Themes the site has
 * keep their kind, so a classic theme's further templates, a block theme's
 * PHP and a child theme (its parent's kind) ask nothing, nor do themes
 * WordPress updates, whose files Studio does not write.
 */
export async function classicThemeQuestion(
	filePath: string
): Promise< { question: string; consequence: string; declined: string } | undefined > {
	const file = resolveSiteFile( filePath );
	const theme = file?.theme;
	if (
		! file ||
		! theme ||
		! /^[^/]+\.php$/.test( theme.file ) ||
		theme.file === 'functions.php' ||
		( await themeKind( file.siteRoot, theme.slug ) ) !== 'unfinished' ||
		( await isUpdatableTheme( file.siteRoot, theme.slug ) )
	) {
		return undefined;
	}
	const fallback = await defaultTheme( file.siteRoot );
	return {
		question: `Make "${ theme.slug }" a classic theme?`,
		consequence: `Its templates are PHP files, edited only in code: the Site Editor cannot edit its templates, header, footer or styles.`,
		declined: `"${ theme.slug }" is to be a block theme, as WordPress's default theme${
			fallback ? `, ${ fallback } (WP_DEFAULT_THEME),` : ''
		} is: its templates are block markup in templates/*.html, with templates/index.html (WP_Theme::is_block_theme() in wp-includes/class-wp-theme.php), and its parts in parts/*.html, all edited in the Site Editor.`,
	};
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
			const broken =
				next[ theme ] === `${ CREATED }unfinished` &&
				! ( await isUpdatableTheme( site.path, theme ) );
			reports.push( {
				key: `block theme ${ theme }`,
				problem: broken ? await missingTemplateProblem( site.path, theme ) : undefined,
				atTurnEnd: true,
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
