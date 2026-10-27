/**
 * Navigation links to sections of the front page that work on the front page
 * only. A navigation link prints its "url" as its href
 * (render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php),
 * and an href of only "#id" resolves against the address of the page it is on,
 * so a menu every page shows takes a visitor on any other page to an id that
 * page does not have. Studio renders the front page and another page as a
 * visitor gets them, and where a link's id is a section of the front page and
 * not of the other page, links it to the front page's section, as the link
 * does on the front page itself.
 */
import path from 'path';
import { readRenderedVersions } from 'cli/ai/block-render-check';
import { siteMarkup, saveMarkup, placeOf } from 'cli/ai/site-markup';
import { isUpdatableTheme } from 'cli/ai/themes';
import { runWpCli } from 'cli/ai/tools/utils';
import type { SiteChangeSource } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

interface Rendered {
	// The "#id" urls of the navigation links WordPress rendered, with their labels.
	links: Record< string, string >;
	ids: string[];
	// Of the front page: where else to look, and the home page's path.
	other?: Record< string, string | number >;
	home?: string;
	stylesheet?: string;
}

// A request as template-loader.php resolves it, rendered by
// get_the_block_template_html() (wp-includes/block-template.php).
const RENDER = ( request: string ) => `
${ request }
$links = array();
add_filter( 'render_block', function ( $html, $block ) use ( &$links ) {
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
}
$other = get_posts( array( 'post_type' => array( 'page', 'post' ), 'post_status' => 'publish', 'numberposts' => 1, 'orderby' => array( 'type' => 'ASC', 'ID' => 'ASC' ), 'exclude' => array( (int) get_option( 'page_on_front' ) ) ) );
echo 'RENDERED=' . wp_json_encode( array(
	'links'      => (object) $links,
	'ids'        => array_values( array_unique( $ids ) ),
	'other'      => $other ? array( 'page' === $other[0]->post_type ? 'page_id' : 'p' => $other[0]->ID ) : array( 'error' => '404' ),
	'home'       => wp_make_link_relative( home_url( '/' ) ),
	'stylesheet' => get_stylesheet(),
) ) . "\\n";`;

const FRONT_PAGE = RENDER( `$_SERVER['REQUEST_URI'] = '/';\nwp();` );
const PAGE = ( vars: Record< string, string | number > ) =>
	RENDER( `wp( ${ phpArray( vars ) } );` );

const phpArray = ( vars: Record< string, string | number > ) =>
	`array( ${ Object.entries( vars )
		.map( ( [ key, value ] ) => `${ JSON.stringify( key ) } => ${ JSON.stringify( value ) }` )
		.join( ', ' ) } )`;

async function render( site: SiteData, php: string ): Promise< Rendered > {
	const output = await runWpCli( site, [ 'eval', php ] );
	const line = output.split( '\n' ).find( ( text ) => text.startsWith( 'RENDERED=' ) );
	if ( ! line ) {
		throw new Error( 'the render printed nothing' );
	}
	return JSON.parse( line.slice( 'RENDERED='.length ) ) as Rendered;
}

// A navigation link or submenu block's comment whose url is `url`.
const linkTo = ( url: string ) =>
	new RegExp(
		`(<!--\\s+wp:navigation-(?:link|submenu)\\s+\\{(?:(?!-->)[\\s\\S])*?"url":")${ url.replace(
			/[.*+?^${}()|[\]\\]/g,
			'\\$&'
		) }(")`,
		'g'
	);

export const sectionLinks: SiteChangeSource = {
	name: 'section links',
	saves: true,
	read: readRenderedVersions,
	async check( site, before, after ) {
		if ( Object.keys( after ).every( ( key ) => before[ key ] === after[ key ] ) ) {
			return { reports: [] };
		}
		let front: Rendered;
		let other: Rendered;
		try {
			front = await render( site, FRONT_PAGE );
			const sections = Object.keys( front.links ).filter( ( url ) =>
				front.ids.includes( url.slice( 1 ) )
			);
			if ( ! sections.length || ! front.other ) {
				return { reports: [] };
			}
			other = await render( site, PAGE( front.other ) );
		} catch {
			// A site WordPress cannot render for says nothing, as a failed note does.
			return { reports: [] };
		}
		const broken = Object.keys( front.links ).filter(
			( url ) => front.ids.includes( url.slice( 1 ) ) && ! other.ids.includes( url.slice( 1 ) )
		);
		if ( ! broken.length ) {
			return { reports: [] };
		}
		const home = front.home ?? '/';
		const themeDir =
			front.stylesheet && ! ( await isUpdatableTheme( site.path, front.stylesheet ) )
				? path.join( site.path, 'wp-content', 'themes', front.stylesheet )
				: undefined;
		const places: string[] = [];
		const fixed = new Set< string >();
		for ( const item of await siteMarkup( site.path, themeDir, {
			holding: '%wp:navigation-%',
		} ) ) {
			let content = item.content;
			for ( const url of broken ) {
				const linked = content.replace( linkTo( url ), `$1${ home }${ url }$2` );
				if ( linked !== content ) {
					fixed.add( url );
					content = linked;
				}
			}
			if ( content !== item.content ) {
				await saveMarkup( site.path, item, content );
				places.push( placeOf( item, site.path ) );
			}
		}
		const named = ( urls: string[] ) =>
			urls.map( ( url ) => `"${ front.links[ url ] || url }" (${ url })` ).join( ', ' );
		const unfixed = broken.filter( ( url ) => ! fixed.has( url ) );
		const lead = `${ site.name }: navigation links ${ named(
			broken
		) } link to sections of the front page, and a url of only "#id" goes to that id on the page it is on (render_block_core_navigation_link() prints the url as the href, in wp-includes/blocks/navigation-link.php), which the site's other pages do not have`;
		return {
			reports: [
				{
					key: 'section links',
					summary: fixed.size
						? `${ lead }. Studio linked ${ named( [
								...fixed,
						  ] ) } to the front page's section (${ home }#id), as they do on the front page, in ${ places.join(
								', '
						  ) }.`
						: undefined,
					problem: unfixed.length
						? `${ lead }. Link ${ named( unfixed ) } to the front page's section: ${ unfixed
								.map( ( url ) => `${ home }${ url }` )
								.join( ', ' ) }.`
						: undefined,
				},
			],
			next: places.length ? await readRenderedVersions( site.path ) : undefined,
		};
	},
};
