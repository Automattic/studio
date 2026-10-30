/**
 * A page of a site as WordPress renders it for a visitor who is not logged in:
 * the request as template-loader.php resolves it, rendered by
 * get_the_block_template_html() (wp-includes/block-template.php), with its
 * template parts. The checks that read the front page share one render of it
 * per call: the links it holds, the ids they can go to, and the blocks it
 * renders as nothing.
 */
import { stat } from 'fs/promises';
import path from 'path';
import { readVersions } from '@studio/agent/node/post-content-check';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { themeMarkupFiles } from '@studio/agent/node/site-markup';
import { wpEvalJson } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { Versions } from '@studio/agent/node/site-changes';

/** The prefix of a markup file's key in the rendered versions. */
export const FILE = 'file ';

// The posts the front end renders, and the active theme's template, template
// part and pattern files, by modification time and size.
export async function readRenderedVersions( sitePath: string ): Promise< Versions > {
	const themes = await readWordPressSite( sitePath, ( site ) => [
		...new Set( [ site.option( 'template' ), site.option( 'stylesheet' ) ] ),
	] );
	const files = (
		await Promise.all(
			themes
				.filter( ( theme ): theme is string => typeof theme === 'string' && theme !== '' )
				.map( ( theme ) =>
					themeMarkupFiles( path.join( sitePath, 'wp-content', 'themes', theme ) )
				)
		)
	).flat();
	const versions = await Promise.all(
		files.map( async ( file ) => {
			const { mtimeMs, size } = await stat( file );
			return [ FILE + file, `${ mtimeMs }:${ size }` ];
		} )
	);
	return { ...( await readVersions( sitePath ) ), ...Object.fromEntries( versions ) };
}

export interface RenderedPage {
	html: string;
	// The "#id" urls of the navigation links WordPress rendered, with their labels.
	links: Record< string, string >;
	ids: string[];
	// The blocks the template renders as nothing, outside the content
	// core/post-content renders and the blocks a dynamic block renders into its
	// own output, which their own checks cover.
	empty: string[];
	// Of the front page: another page to render, and the home page's path.
	other?: Record< string, string | number >;
	home: string;
	stylesheet: string;
}

const RENDER = ( request: string ) => `
${ request }
$links   = array();
$empty   = array();
$content = 0;
add_filter( 'render_block_data', function ( $parsed, $source, $parent_block ) use ( &$content ) {
	$parsed['studioSkipped'] = $content > 0 || ( $parent_block && $parent_block->block_type && $parent_block->block_type->is_dynamic() );
	if ( 'core/post-content' === $parsed['blockName'] ) {
		++$content;
	}
	return $parsed;
}, PHP_INT_MAX, 3 );
add_filter( 'render_block', function ( $html, $block ) use ( &$links, &$empty, &$content ) {
	if ( 'core/post-content' === $block['blockName'] ) {
		--$content;
	}
	if ( ! empty( $block['blockName'] ) && empty( $block['studioSkipped'] ) && '' === trim( $html ) ) {
		$empty[] = $block['blockName'];
	}
	$url = $block['attrs']['url'] ?? '';
	if ( in_array( $block['blockName'], array( 'core/navigation-link', 'core/navigation-submenu' ), true ) && is_string( $url ) && str_starts_with( $url, '#' ) ) {
		$links[ $url ] = wp_strip_all_tags( (string) ( $block['attrs']['label'] ?? '' ) );
	}
	return $html;
}, PHP_INT_MAX, 2 );
$tags = array( 'is_embed' => 'get_embed_template', 'is_404' => 'get_404_template', 'is_search' => 'get_search_template', 'is_front_page' => 'get_front_page_template', 'is_home' => 'get_home_template', 'is_privacy_policy' => 'get_privacy_policy_template', 'is_post_type_archive' => 'get_post_type_archive_template', 'is_tax' => 'get_taxonomy_template', 'is_attachment' => 'get_attachment_template', 'is_single' => 'get_single_template', 'is_page' => 'get_page_template', 'is_singular' => 'get_singular_template', 'is_category' => 'get_category_template', 'is_tag' => 'get_tag_template', 'is_author' => 'get_author_template', 'is_date' => 'get_date_template', 'is_archive' => 'get_archive_template' );
$template = false;
foreach ( $tags as $tag => $getter ) {
	if ( $tag() && ( $template = $getter() ) ) {
		break;
	}
}
if ( ! $template ) {
	get_index_template();
}
$html = empty( $GLOBALS['_wp_current_template_content'] ) ? '' : get_the_block_template_html();
$ids  = array();
$tags = new WP_HTML_Tag_Processor( $html );
while ( $tags->next_tag() ) {
	$id = $tags->get_attribute( 'id' );
	if ( is_string( $id ) && '' !== $id ) {
		$ids[] = $id;
	}
	// Core's skip link, which every page gets to its own main (_block_template_add_skip_link() in wp-includes/block-template.php).
	$href = 'A' === $tags->get_tag() && 'wp-skip-link' !== $tags->get_attribute( 'id' ) ? $tags->get_attribute( 'href' ) : null;
	if ( is_string( $href ) && strlen( $href ) > 1 && str_starts_with( $href, '#' ) && ! isset( $links[ $href ] ) ) {
		$links[ $href ] = '';
	}
}
$other = get_posts( array( 'post_type' => array( 'page', 'post' ), 'post_status' => 'publish', 'numberposts' => 1, 'orderby' => array( 'type' => 'ASC', 'ID' => 'ASC' ), 'exclude' => array( (int) get_option( 'page_on_front' ) ) ) );
echo wp_json_encode( array(
	'html'       => $html,
	'links'      => (object) $links,
	'ids'        => array_values( array_unique( $ids ) ),
	'empty'      => array_values( array_unique( $empty ) ),
	'other'      => $other ? array( 'page' === $other[0]->post_type ? 'page_id' : 'p' => $other[0]->ID ) : array( 'error' => '404' ),
	'home'       => wp_make_link_relative( home_url( '/' ) ),
	'stylesheet' => get_stylesheet(),
) );`;

const phpArray = ( vars: Record< string, string | number > ) =>
	`array( ${ Object.entries( vars )
		.map( ( [ key, value ] ) => `${ JSON.stringify( key ) } => ${ JSON.stringify( value ) }` )
		.join( ', ' ) } )`;

/** A page by its query vars, as `wp()` parses a request for them. */
export function renderPage(
	host: StudioAgentHost,
	site: HostSite,
	vars: Record< string, string | number >
): Promise< RenderedPage > {
	return wpEvalJson( host, site, RENDER( `wp( ${ phpArray( vars ) } );` ) );
}

// The last front page render of each site, by what it was rendered from.
const rendered = new Map< string, { from: string; page: Promise< RenderedPage > } >();

/**
 * The front page, rendered again only when what it renders from changed: the
 * posts, the active theme's markup files, and the options that pick the theme
 * and the front page.
 */
export async function renderFrontPage(
	host: StudioAgentHost,
	site: HostSite
): Promise< RenderedPage > {
	const from = JSON.stringify( [
		await readRenderedVersions( site.path ),
		await readWordPressSite( site.path, ( wp ) =>
			[ 'show_on_front', 'page_on_front', 'template', 'stylesheet' ].map( ( name ) =>
				wp.option( name )
			)
		),
	] );
	const last = rendered.get( site.path );
	if ( last?.from === from ) {
		return last.page;
	}
	const page = wpEvalJson< RenderedPage >(
		host,
		site,
		RENDER( `$_SERVER['REQUEST_URI'] = '/';\nwp();` )
	);
	rendered.set( site.path, { from, page } );
	// A render that failed is tried again.
	page.catch( () => rendered.get( site.path )?.page === page && rendered.delete( site.path ) );
	return page;
}
