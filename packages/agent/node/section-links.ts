/**
 * Links to sections of the front page that work on the front page only. A
 * navigation link prints its "url" as its href
 * (render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php),
 * as a paragraph or button prints the href in its HTML, and an href of only
 * "#id" resolves against the address of the page it is on, so a link every
 * page shows, as a header or footer template part's are, takes a visitor on
 * any other page to an id that page does not have. Studio renders the front
 * page and another page as a visitor gets them, and where a link both render
 * names a section of the front page the other page lacks, links it to the
 * front page's section, as the link does on the front page itself: a
 * navigation link wherever it is held, and a link in a template part's HTML.
 */
import path from 'path';
import { readRenderedVersions } from '@studio/agent/node/block-render-check';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { siteMarkup, saveMarkup, placeOf } from '@studio/agent/node/site-markup';
import { isUpdatableTheme } from '@studio/agent/node/themes';
import { runWpCli } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

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
	// Core's skip link, which every page gets to its own main (_block_template_add_skip_link() in wp-includes/block-template.php).
	$href = 'A' === $tags->get_tag() && 'wp-skip-link' !== $tags->get_attribute( 'id' ) ? $tags->get_attribute( 'href' ) : null;
	if ( is_string( $href ) && strlen( $href ) > 1 && str_starts_with( $href, '#' ) && ! isset( $links[ $href ] ) ) {
		$links[ $href ] = '';
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

async function render( host: StudioAgentHost, site: HostSite, php: string ): Promise< Rendered > {
	const output = await runWpCli( host, site, [ 'eval', php ] );
	const line = output.split( '\n' ).find( ( text ) => text.startsWith( 'RENDERED=' ) );
	if ( ! line ) {
		throw new Error( 'the render printed nothing' );
	}
	return JSON.parse( line.slice( 'RENDERED='.length ) ) as Rendered;
}

const escape = ( url: string ) => url.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

// A navigation link or submenu block's comment whose url is `url`.
const linkTo = ( url: string ) =>
	new RegExp(
		`(<!--\\s+wp:navigation-(?:link|submenu)\\s+\\{(?:(?!-->)[\\s\\S])*?"url":")${ escape(
			url
		) }(")`,
		'g'
	);

// A link's href of `url`, in a block's HTML.
const hrefTo = ( url: string ) =>
	new RegExp( `(<a\\s(?:[^>]*?\\s)?href=")${ escape( url ) }(")`, 'g' );

// What the site renders, and which page is its front page: the options
// WP_Query::is_front_page() reads (wp-includes/class-wp-query.php), so a
// front page chosen after its sections and links were written is checked too.
const FRONT_PAGE_OPTIONS = [ 'show_on_front', 'page_on_front' ];
const readVersions = async ( sitePath: string ) => ( {
	...( await readRenderedVersions( sitePath ) ),
	...( await readWordPressSite( sitePath, ( site ) =>
		Object.fromEntries(
			FRONT_PAGE_OPTIONS.map( ( option ) => [ option, String( site.option( option ) ?? '' ) ] )
		)
	) ),
} );

export const sectionLinks: SiteChangeSource = {
	name: 'section links',
	saves: true,
	read: readVersions,
	async check( site, before, after, host ) {
		if ( Object.keys( after ).every( ( key ) => before[ key ] === after[ key ] ) ) {
			return { reports: [] };
		}
		let front: Rendered;
		let other: Rendered;
		try {
			front = await render( host, site, FRONT_PAGE );
			const sections = Object.keys( front.links ).filter( ( url ) =>
				front.ids.includes( url.slice( 1 ) )
			);
			if ( ! sections.length || ! front.other ) {
				return { reports: [] };
			}
			other = await render( host, site, PAGE( front.other ) );
		} catch {
			// A site WordPress cannot render for says nothing, as a failed note does.
			return { reports: [] };
		}
		// Links the other page renders too, as a template part's are, to a section
		// only the front page has.
		const broken = Object.keys( front.links ).filter(
			( url ) =>
				front.ids.includes( url.slice( 1 ) ) &&
				url in other.links &&
				! other.ids.includes( url.slice( 1 ) )
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
			holding: '%#%',
		} ) ) {
			const part =
				item.type === 'wp_template_part' ||
				( item.file !== undefined && path.basename( path.dirname( item.file ) ) === 'parts' );
			let content = item.content;
			for ( const url of broken ) {
				let linked = content.replace( linkTo( url ), `$1${ home }${ url }$2` );
				// A template part renders on every page; a link in its HTML, as a
				// paragraph's or a button's, is its block's href.
				if ( part ) {
					linked = linked.replace( hrefTo( url ), `$1${ home }${ url }$2` );
				}
				if ( linked !== content ) {
					fixed.add( url );
					content = linked;
				}
			}
			if ( content !== item.content ) {
				await saveMarkup( host, site.path, item, content );
				places.push( placeOf( item, site.path ) );
			}
		}
		const named = ( urls: string[] ) =>
			urls
				.map( ( url ) => ( front.links[ url ] ? `"${ front.links[ url ] }" (${ url })` : url ) )
				.join( ', ' );
		const unfixed = broken.filter( ( url ) => ! fixed.has( url ) );
		const lead = `${ site.name }: links ${ named(
			broken
		) }, which the site's other pages render too, link to sections of the front page, and an href of only "#id" goes to that id on the page it is on (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php), which the site's other pages do not have`;
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
			next: places.length ? await readVersions( site.path ) : undefined,
		};
	},
};
