/**
 * Template parts a block theme's templates include that WordPress has none
 * of. A template-part block renders a published wp_template_part post of the
 * active theme with its slug, else the theme's part file of that slug, from
 * the theme's parts folder or its parent's (_get_block_template_file() in
 * wp-includes/block-template-utils.php), and renders nothing when it has
 * neither, or names another theme than the active one
 * (render_block_core_template_part() in wp-includes/blocks/template-part.php).
 * So a header written to templates/header.html, a template, leaves the page
 * with no header.
 *
 * When a call changes a theme's templates or parts, Studio says which parts
 * they include that render nothing, and keeps the problem open until the turn
 * ends with each resolved, as the parts can follow the templates.
 */
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { fileStamp } from '@studio/agent/node/active-code';
import { savedPosts } from '@studio/agent/node/saved-copies';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { exists, isUpdatableTheme, themesDir } from '@studio/agent/node/themes';
import { wpEvalJson } from '@studio/agent/shared/tools/utils';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

// A block theme's folders, and those of themes from before WordPress 5.9
// (WP_Theme::get_block_template_folders() in wp-includes/class-wp-theme.php).
const TEMPLATE_FOLDERS = [ 'templates', 'block-templates' ];
const PART_FOLDERS = [ 'parts', 'block-template-parts' ];

// A theme's template and part files, as <folder>/<file>.
async function templateFiles( dir: string ): Promise< string[] > {
	const files: string[] = [];
	for ( const folder of [ ...TEMPLATE_FOLDERS, ...PART_FOLDERS ] ) {
		for ( const file of await readdir( path.join( dir, folder ) ).catch( () => [] as string[] ) ) {
			files.push( `${ folder }/${ file }` );
		}
	}
	return files;
}

/** A part a theme file includes that renders nothing: what includes it, and why. */
interface MissingPart {
	file: string;
	slug: string;
	// The other theme the block names, when it names one.
	theme?: string;
}

// A theme's version: what its parts render from, and, once WordPress was
// asked, the parts that render nothing.
interface ThemeVersion {
	from: string;
	missing?: MissingPart[];
}

// What a theme's template parts render from: its template and part files and
// style.css, the parts saved for it, and the active theme.
async function partsFrom( sitePath: string, theme: string ): Promise< string > {
	const dir = themesDir( sitePath, theme );
	const files = [ 'style.css', ...( await templateFiles( dir ) ) ];
	const stats = await Promise.all(
		files.sort().map( async ( file ) => {
			const info = await stat( path.join( dir, file ) ).catch( () => undefined );
			return info && `${ file }:${ fileStamp( info ) }`;
		} )
	);
	const saved = await readWordPressSite( sitePath, ( site ) => [
		site.option( 'stylesheet' ),
		site.option( 'template' ),
		savedPosts( site, theme )
			.filter( ( post ) => post.postType === 'wp_template_part' )
			.map( ( post ) => `${ post.id }:${ post.slug }:${ post.modified }` ),
	] );
	return JSON.stringify( [ stats.filter( Boolean ), saved ] );
}

// Whether any of a theme's template and part files includes a part.
async function includesParts( sitePath: string, theme: string ): Promise< boolean > {
	const dir = themesDir( sitePath, theme );
	for ( const file of await templateFiles( dir ) ) {
		const markup = await readFile( path.join( dir, file ), 'utf8' ).catch( () => '' );
		if ( markup.includes( '<!-- wp:template-part' ) ) {
			return true;
		}
	}
	return false;
}

// The template-part blocks of each theme's template and part files that
// WordPress renders as nothing: each rendered as WordPress renders it with the
// theme, the active one for the parent of an active child theme, and missing
// when it found neither a saved part nor a part file
// (render_block_core_template_part() in wp-includes/blocks/template-part.php).
const MISSING_PARTS = `
$found = null;
$hit   = function () use ( &$found ) { $found = $found ?? true; };
add_action( 'render_block_core_template_part_post', $hit );
add_action( 'render_block_core_template_part_file', $hit );
// An empty part file renders as an empty part.
add_action( 'render_block_core_template_part_none', function ( $id, $attributes, $file ) use ( &$found ) { $found = $found ?? '' !== $file; }, 10, 3 );
$active = get_stylesheet();
$parent = get_template();
$out    = array();
foreach ( $data as $slug ) {
	$theme   = wp_get_theme( $slug );
	$preview = $slug === $parent && $slug !== $active ? wp_get_theme( $active ) : $theme;
	$filters = array(
		'stylesheet' => function () use ( $preview ) { return $preview->get_stylesheet(); },
		'template'   => function () use ( $preview ) { return $preview->get_template(); },
	);
	foreach ( $filters as $hook => $filter ) {
		add_filter( $hook, $filter );
	}
	$missing = array();
	$walk    = function ( $blocks, $file ) use ( &$walk, &$found, &$missing ) {
		foreach ( $blocks as $block ) {
			$part = $block['attrs']['slug'] ?? null;
			if ( 'core/template-part' === $block['blockName'] && is_string( $part ) && '' !== $part ) {
				$found = null;
				render_block( $block );
				if ( true !== $found ) {
					$of        = $block['attrs']['theme'] ?? null;
					$missing[] = array( 'file' => $file, 'slug' => $part ) + ( is_string( $of ) && get_stylesheet() !== $of ? array( 'theme' => $of ) : array() );
				}
			}
			$walk( $block['innerBlocks'], $file );
		}
	};
	$folders = get_block_theme_folders( $slug );
	foreach ( array( $folders['wp_template'], $folders['wp_template_part'] ) as $folder ) {
		foreach ( glob( $theme->get_stylesheet_directory() . "/$folder/*.html" ) ?: array() as $path ) {
			$walk( parse_blocks( (string) file_get_contents( $path ) ), $folder . '/' . basename( $path ) );
		}
	}
	foreach ( $filters as $hook => $filter ) {
		remove_filter( $hook, $filter );
	}
	$out[ $slug ] = $missing;
}
echo wp_json_encode( (object) $out );`;

const list = ( items: string[] ) => [ ...new Set( items ) ].join( ', ' );

async function describe( root: string, theme: string, missing: MissingPart[] ): Promise< string > {
	const dir = themesDir( root, theme );
	const sentences: string[] = [];
	const unfiled = missing.filter( ( part ) => ! part.theme );
	if ( unfiled.length ) {
		const slugs = [ ...new Set( unfiled.map( ( part ) => part.slug ) ) ];
		// A part written where WordPress reads templates.
		const templates = (
			await Promise.all(
				slugs.map( async ( slug ) =>
					( await exists( path.join( dir, 'templates', `${ slug }.html` ) ) )
						? `templates/${ slug }.html`
						: ''
				)
			)
		).filter( Boolean );
		sentences.push(
			`${ list( unfiled.map( ( part ) => part.file ) ) } of wp-content/themes/${ theme } include${
				unfiled.length === 1 ? 's' : ''
			} the template part${ slugs.length === 1 ? '' : 's' } ${ list(
				slugs
			) }, which the theme has no parts/ file of (${ list(
				slugs.map( ( slug ) => `parts/${ slug }.html` )
			) }) and the site no saved wp_template_part of. WordPress reads a theme's parts from its parts/ folder, as Twenty Twenty-Five's parts/header.html, and renders a part it has none of as nothing (_get_block_template_file() in wp-includes/block-template-utils.php, render_block_core_template_part() in wp-includes/blocks/template-part.php).${
				templates.length
					? ` ${ list( templates ) } ${
							templates.length === 1 ? 'is a template' : 'are templates'
					  }, which WordPress renders for the page of that name, not as a part.`
					: ''
			}`
		);
	}
	const elsewhere = missing.filter( ( part ) => part.theme );
	if ( elsewhere.length ) {
		sentences.push(
			`${ list( elsewhere.map( ( part ) => part.file ) ) } of wp-content/themes/${ theme } include${
				elsewhere.length === 1 ? 's' : ''
			} ${ list(
				elsewhere.map( ( part ) => `${ part.slug } of the theme ${ part.theme }` )
			) }, and WordPress renders a part of a theme other than the active one as nothing (render_block_core_template_part() in wp-includes/blocks/template-part.php). Twenty Twenty-Five's templates name only the slug: <!-- wp:template-part {"slug":"header"} /-->.`
		);
	}
	return sentences.join( ' ' );
}

const key = ( part: MissingPart ) => `${ part.file } ${ part.slug } ${ part.theme ?? '' }`;

export const missingTemplateParts: SiteChangeSource = {
	name: 'missing template parts',
	async read( sitePath, last ) {
		const root = themesDir( sitePath );
		const versions: Versions = {};
		for ( const theme of await readdir( root ).catch( () => [] as string[] ) ) {
			// A folder with a style.css is a theme (WP_Theme in wp-includes/class-wp-theme.php).
			if ( await exists( path.join( root, theme, 'style.css' ) ) ) {
				const from = await partsFrom( sitePath, theme );
				const known = last?.[ theme ] && ( JSON.parse( last[ theme ] ) as ThemeVersion );
				versions[ theme ] =
					known && known.from === from ? last![ theme ] : JSON.stringify( { from } );
			}
		}
		return versions;
	},
	async check( site, before, after, host ) {
		const version = ( versions: Versions, theme: string ): ThemeVersion | undefined =>
			versions[ theme ] ? JSON.parse( versions[ theme ] ) : undefined;
		const changed: string[] = [];
		for ( const theme of Object.keys( after ) ) {
			if (
				version( before, theme )?.from !== version( after, theme )?.from &&
				! ( await isUpdatableTheme( site.path, theme ) )
			) {
				changed.push( theme );
			}
		}
		// WordPress is asked of the themes whose files include a part.
		const asked = (
			await Promise.all(
				changed.map( async ( theme ) =>
					( await includesParts( site.path, theme ) ) ? [ theme ] : []
				)
			)
		).flat();
		// A site WordPress cannot be asked of has nothing stated.
		const found = asked.length
			? await wpEvalJson< Record< string, MissingPart[] > >(
					host,
					site,
					MISSING_PARTS,
					asked
			  ).catch( () => undefined )
			: {};
		if ( ! changed.length || ! found ) {
			return { reports: [] };
		}
		const next = { ...after };
		const reports = [];
		for ( const theme of changed ) {
			const missing = found[ theme ] ?? [];
			next[ theme ] = JSON.stringify( { ...version( after, theme ), missing } );
			const was = new Set( ( version( before, theme )?.missing ?? [] ).map( key ) );
			const added = missing.filter( ( part ) => ! was.has( key( part ) ) );
			const problem = missing.length
				? `${ await describe(
						site.path,
						theme,
						missing
				  ) } Write each part to the theme's parts/ folder and include it by its slug, or take its block out.`
				: undefined;
			reports.push( {
				key: `missing template parts of ${ theme }`,
				summary: added.length ? await describe( site.path, theme, added ) : undefined,
				problem,
				atTurnEnd: true,
			} );
		}
		return { reports, next };
	},
};
