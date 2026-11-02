/**
 * The active theme's own style.css, loaded where its rules apply. WordPress
 * never loads a theme's style.css by itself: a theme enqueues it on the front
 * end, as Twenty Twenty-Five's functions.php does with wp_enqueue_style() on
 * wp_enqueue_scripts, and adds it to the block editor with add_editor_style().
 * When the active theme's style.css holds rules WordPress does not load, Studio
 * adds what is missing to the theme's functions.php in that same form, and
 * says so.
 *
 * WordPress itself says what loads: the check runs the theme's hooks and reads
 * the styles queued (wp_styles()) and the editor stylesheets
 * (get_editor_stylesheets()).
 */
import { readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { activeThemes, isUpdatableTheme } from '@studio/agent/node/themes';
import { wpEvalJson } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

const LOADED = `
do_action( 'wp_enqueue_scripts' );
$styles = wp_styles();
$styles->all_deps( $styles->queue );
$uri = get_stylesheet_uri();
$front = false;
foreach ( $styles->to_do as $handle ) {
	$src = $styles->registered[ $handle ]->src ?? '';
	$front = $front || ( is_string( $src ) && strtok( $src, '?' ) === $uri );
}
echo wp_json_encode( array( 'front' => $front, 'editor' => in_array( $uri, get_editor_stylesheets(), true ) ) );
`;

interface Loaded {
	front: boolean;
	editor: boolean;
}

async function loaded( host: StudioAgentHost, site: HostSite ): Promise< Loaded > {
	return wpEvalJson< Loaded >( host, site, LOADED );
}

/** Whether a stylesheet holds rules, past its header comment. */
export function holdsRules( css: string ): boolean {
	return css.replace( /\/\*[\s\S]*?\*\//g, '' ).trim() !== '';
}

/**
 * The functions.php code that loads a theme's style.css where `missing` says
 * it is not, in Twenty Twenty-Five's form. A standalone theme loads its own
 * file (get_parent_theme_file_uri(), so a child of it still loads it); a child
 * theme loads its style.css with get_stylesheet_uri(), as the Child Themes
 * handbook does.
 */
function loadingCode( slug: string, child: boolean, missing: Loaded ): string {
	const prefix = slug.replace( /[^A-Za-z0-9]+/g, '_' ).toLowerCase();
	const src = child ? 'get_stylesheet_uri()' : "get_parent_theme_file_uri( 'style.css' )";
	const front = `
if ( ! function_exists( '${ prefix }_enqueue_styles' ) ) :
	/**
	 * Enqueues the theme stylesheet on the front.
	 *
	 * @return void
	 */
	function ${ prefix }_enqueue_styles() {
		wp_enqueue_style(
			'${ slug }-style',
			${ src },
			array(),
			wp_get_theme()->get( 'Version' )
		);
	}
endif;
add_action( 'wp_enqueue_scripts', '${ prefix }_enqueue_styles' );
`;
	const editor = `
if ( ! function_exists( '${ prefix }_editor_style' ) ) :
	/**
	 * Enqueues the theme stylesheet in the editors.
	 *
	 * @return void
	 */
	function ${ prefix }_editor_style() {
		add_editor_style( 'style.css' );
	}
endif;
add_action( 'after_setup_theme', '${ prefix }_editor_style' );
`;
	return ( missing.front ? '' : front ) + ( missing.editor ? '' : editor );
}

/** functions.php with `code` added at its end, in PHP. */
export function withCode( functions: string | undefined, code: string ): string {
	if ( functions === undefined ) {
		return `<?php${ code }`;
	}
	const ends = functions.trimEnd();
	// A closing tag at the end goes, as the WordPress coding standards omit it.
	if ( ends.endsWith( '?>' ) ) {
		return `${ ends.slice( 0, -2 ).trimEnd() }\n${ code }`;
	}
	// A file that ends outside PHP takes the code in a PHP block of its own.
	const inPhp = functions.lastIndexOf( '<?php' ) > functions.lastIndexOf( '?>' );
	return inPhp ? `${ ends }\n${ code }` : `${ functions }\n<?php${ code }`;
}

const stampOf = ( file: string ) =>
	stat( file ).then(
		( { mtimeMs, size } ) => `${ mtimeMs }:${ size }`,
		() => '-'
	);

const themesOf = ( sitePath: string ) => readWordPressSite( sitePath, activeThemes );

export const themeStylesheet: SiteChangeSource = {
	name: 'theme-stylesheet',
	saves: true,
	async read( sitePath ) {
		const [ stylesheet, template = stylesheet ] = ( await themesOf( sitePath ) ) ?? [];
		if ( ! stylesheet ) {
			return {};
		}
		const dir = ( theme: string ) => path.join( sitePath, 'wp-content', 'themes', theme );
		const stamps = await Promise.all( [
			stampOf( path.join( dir( stylesheet ), 'style.css' ) ),
			stampOf( path.join( dir( stylesheet ), 'functions.php' ) ),
			stampOf( path.join( dir( template ), 'functions.php' ) ),
		] );
		return { [ stylesheet ]: `${ template }|${ stamps.join( '|' ) }` };
	},
	async check( site, before, after, host ) {
		const [ theme ] = Object.keys( after );
		if ( ! theme || before[ theme ] === after[ theme ] ) {
			return { reports: [] };
		}
		const dir = path.join( site.path, 'wp-content', 'themes', theme );
		const css = await readFile( path.join( dir, 'style.css' ), 'utf8' ).catch( () => '' );
		if ( ! holdsRules( css ) || ( await isUpdatableTheme( site.path, theme ) ) ) {
			return { reports: [] };
		}
		const was = await loaded( host, site );
		if ( was.front && was.editor ) {
			return { reports: [] };
		}
		const child = after[ theme ].split( '|' )[ 0 ] !== theme;
		const file = path.join( dir, 'functions.php' );
		const functions = await readFile( file, 'utf8' ).catch( () => undefined );
		await writeFile( file, withCode( functions, loadingCode( theme, child, was ) ) );
		const now = await loaded( host, site );
		const where = [ ! was.front && 'the front end', ! was.editor && 'the block editor' ]
			.filter( Boolean )
			.join( ' and ' );
		const key = `stylesheet of ${ theme }`;
		const relative = `wp-content/themes/${ theme }/functions.php`;
		const next = await themeStylesheet.read( site.path, undefined, host );
		if ( now.front && now.editor ) {
			return {
				reports: [
					{
						key,
						summary: `WordPress loads no theme's style.css by itself, so ${ theme }'s rules did not reach ${ where }. Studio added to ${ relative } what Twenty Twenty-Five's functions.php does: wp_enqueue_style() on wp_enqueue_scripts for the front end, add_editor_style() for the editor.`,
					},
				],
				next,
			};
		}
		return {
			reports: [
				{
					key,
					problem: `WordPress loads no theme's style.css by itself, and ${ theme }'s rules still do not reach ${ [
						! now.front && 'the front end',
						! now.editor && 'the block editor',
					]
						.filter( Boolean )
						.join(
							' or '
						) } after Studio added wp_enqueue_style() and add_editor_style() to ${ relative }, which may already declare the functions it added. Enqueue style.css there, as Twenty Twenty-Five's functions.php does.`,
				},
			],
			next,
		};
	},
};
