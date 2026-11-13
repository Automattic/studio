import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { unrenderedPages } from '@studio/agent/node/open-problems';
import { wpEvalJson } from '@studio/agent/shared/tools/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to resolve the templates with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const SHOWN = '<!-- wp:post-content /-->';
const NOT_SHOWN = '<!-- wp:heading -->\n<h2>Hi</h2>\n<!-- /wp:heading -->';
const pattern = ( slug: string ) => `<!-- wp:pattern {"slug":"${ slug }"} /-->`;
const part = ( slug: string ) => `<!-- wp:template-part {"slug":"${ slug }"} /-->`;

interface Case {
	name: string;
	options?: Record< string, string >;
	// Templates of the child theme bakery, and of its parent bakery-parent.
	files?: Record< string, string >;
	parentFiles?: Record< string, string >;
	parts?: Record< string, string >;
	patterns?: Record< string, string >;
	// Templates saved in the Site Editor.
	saved?: Record< string, string >;
	// A page's template, as the editor's Template panel assigns it.
	assigned?: string;
	// The parent theme as one WordPress updates, which the site does not own.
	updatable?: boolean;
	// A must-use plugin the site runs.
	plugin?: string;
	raised: string[];
	problems?: number;
}

// A plugin's archive at a page, the way WooCommerce makes its shop page the
// products archive: the page's request queries the posts, and the page stays
// the queried object.
const ARCHIVE_PAGE = `add_action( 'init', function () {
	register_post_type( 'lesson', array( 'public' => true, 'has_archive' => true ) );
} );
add_action( 'pre_get_posts', function ( $query ) {
	if ( ! $query->is_main_query() ) {
		return;
	}
	$page = get_posts( array( 'post_type' => 'page', 'title' => 'Classes' ) )[0] ?? null;
	if ( ! $page || (int) $query->get( 'page_id' ) !== $page->ID ) {
		return;
	}
	$query->set( 'post_type', 'lesson' );
	$query->set( 'page_id', '' );
	$query->is_singular          = false;
	$query->is_post_type_archive = true;
	$query->is_archive           = true;
	$query->queried_object       = $page;
	$query->queried_object_id    = $page->ID;
} );`;

const STATIC = { show_on_front: 'page', page_on_front: '#Home', page_for_posts: '#Journal' };

describe.runIf( WORDPRESS )( 'the pages whose template WordPress renders no content with', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	const ids: Record< string, number > = {};
	const theme = ( name: string, file: string ) =>
		path.join( site.path, 'wp-content/themes', name, file );
	const withIds = ( text: string ) =>
		text.replace( /#(\w+)/g, ( match, title: string ) => String( ids[ title ] ?? match ) );
	const write = ( file: string, content: string ) => {
		mkdirSync( path.dirname( file ), { recursive: true } );
		writeFileSync( file, withIds( content ) );
	};

	beforeAll( async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'unrendered-pages-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Bakery' );
		host = liveHost( site );
		write(
			theme( 'bakery-parent', 'style.css' ),
			'/*\nTheme Name: Bakery Parent\nVersion: 1.0\n*/'
		);
		write( theme( 'bakery', 'style.css' ), '/*\nTheme Name: Bakery\nTemplate: bakery-parent\n*/' );
		write( theme( 'bakery-parent', 'templates/index.html' ), SHOWN );
		Object.assign(
			ids,
			await wpEvalJson(
				host,
				site,
				[
					'switch_theme( "bakery" );',
					'foreach ( get_posts( array( "post_type" => "any", "post_status" => "any", "numberposts" => -1 ) ) as $post ) { wp_delete_post( $post->ID, true ); }',
					'$ids = array();',
					'foreach ( array( "Classes", "About", "Journal", "Home" ) as $title ) {',
					'	$ids[ $title ] = wp_insert_post( array( "post_type" => "page", "post_status" => "publish", "post_title" => $title ) );',
					'}',
					'echo wp_json_encode( $ids );',
				].join( '\n' )
			)
		);
	}, 120000 );
	afterAll( () => site && rmSync( site.path, { recursive: true, force: true } ) );

	const run = async ( {
		options = STATIC,
		files = {},
		parentFiles = {},
		parts = {},
		patterns = {},
		saved = {},
		assigned,
		updatable,
		plugin,
	}: Omit< Case, 'name' | 'raised' > ) => {
		const mustUse = path.join( site.path, 'wp-content/mu-plugins/unrendered-pages-case.php' );
		rmSync( mustUse, { force: true } );
		if ( plugin ) {
			write( mustUse, `<?php\n${ plugin }` );
		}
		for ( const name of [ 'bakery', 'bakery-parent' ] ) {
			for ( const folder of [ 'templates', 'parts', 'patterns' ] ) {
				rmSync( theme( name, folder ), { recursive: true, force: true } );
			}
		}
		for ( const [ slug, content ] of Object.entries( { index: SHOWN, ...parentFiles } ) ) {
			write( theme( 'bakery-parent', `templates/${ slug }.html` ), content );
		}
		for ( const [ slug, content ] of Object.entries( files ) ) {
			write( theme( 'bakery', `templates/${ withIds( slug ) }.html` ), content );
		}
		for ( const [ slug, content ] of Object.entries( parts ) ) {
			write( theme( 'bakery', `parts/${ slug }.html` ), content );
		}
		for ( const [ slug, content ] of Object.entries( patterns ) ) {
			write(
				theme( 'bakery', `patterns/${ slug.split( '/' )[ 1 ] }.php` ),
				`<?php\n/**\n * Title: ${ slug }\n * Slug: ${ slug }\n */\n?>\n${ content }`
			);
		}
		await wpEvalJson(
			host,
			site,
			[
				'foreach ( get_posts( array( "post_type" => "wp_template", "post_status" => "any", "numberposts" => -1 ) ) as $post ) { wp_delete_post( $post->ID, true ); }',
				'foreach ( array( "show_on_front" => "posts", "page_on_front" => 0, "page_for_posts" => 0 ) as $name => $value ) { update_option( $name, $data["options"][ $name ] ?? $value ); }',
				'foreach ( $data["saved"] as $slug => $content ) {',
				'	$id = wp_insert_post( array( "post_type" => "wp_template", "post_status" => "publish", "post_name" => $slug, "post_title" => $slug, "post_content" => $content ) );',
				'	wp_set_post_terms( $id, "bakery", "wp_theme" );',
				'}',
				'update_post_meta( $data["about"], "_wp_page_template", $data["assigned"] );',
				'$updates = new stdClass(); $updates->checked = array( "bakery" => "1.0", "bakery-parent" => "1.0" ); $updates->response = array(); $updates->no_update = $data["updatable"] ? array( "bakery-parent" => array( "theme" => "bakery-parent", "new_version" => "1.0" ) ) : array();',
				'set_site_transient( "update_themes", $updates );',
				'wp_get_theme()->delete_pattern_cache(); wp_get_theme()->parent()->delete_pattern_cache();',
				'echo "{}";',
			].join( '\n' ),
			{
				options: JSON.parse( withIds( JSON.stringify( options ) ) ),
				saved,
				about: ids.About,
				assigned: assigned ?? '',
				updatable: !! updatable,
			}
		);
		return unrenderedPages( host, site.path );
	};

	it.each< Case >( [
		// WordPress renders the front-page template at the front page under either
		// Reading setting, and shows a page there only through post-content.
		{
			name: 'a front-page template without post-content',
			files: { 'front-page': NOT_SHOWN },
			raised: [
				'WordPress renders wp-content/themes/bakery/templates/front-page.html at the front page',
				'so page #Home "Home", the front page',
			],
			problems: 1,
		},
		{ name: 'a front-page template with post-content', files: { 'front-page': SHOWN }, raised: [] },
		{
			name: 'latest posts on the front',
			options: {},
			files: { 'front-page': NOT_SHOWN },
			raised: [ 'so no page set as the homepage' ],
		},
		{
			name: 'a theme pattern with post-content',
			files: { 'front-page': pattern( 'bakery/main' ) },
			patterns: { 'bakery/main': SHOWN },
			raised: [],
		},
		{
			name: 'a theme pattern without it',
			files: { 'front-page': pattern( 'bakery/main' ) },
			patterns: { 'bakery/main': NOT_SHOWN },
			raised: [ 'get_front_page_template' ],
		},
		{
			name: 'a pattern no theme registers',
			files: { 'front-page': pattern( 'other/main' ) },
			raised: [ 'get_front_page_template' ],
		},
		{
			name: 'a template part with post-content',
			files: { 'front-page': part( 'main' ) },
			parts: { main: SHOWN },
			raised: [],
		},
		{
			name: 'a saved front-page template with post-content',
			files: { 'front-page': NOT_SHOWN },
			saved: { 'front-page': SHOWN },
			raised: [],
		},
		{
			name: 'a saved front-page template without it',
			files: { 'front-page': SHOWN },
			saved: { 'front-page': NOT_SHOWN },
			raised: [ 'the front-page template saved in the Site Editor (post ' ],
		},
		{
			name: "the parent theme's front-page template",
			parentFiles: { 'front-page': NOT_SHOWN },
			raised: [ 'wp-content/themes/bakery-parent/templates/front-page.html at the front page' ],
		},
		// Each page renders with the template the page hierarchy picks.
		{
			name: "a page's own template without post-content",
			files: { 'page-classes': NOT_SHOWN, page: SHOWN },
			raised: [
				'page #Classes "Classes" with wp-content/themes/bakery/templates/page-classes.html',
			],
		},
		{
			name: "a page's own template with post-content",
			files: { 'page-classes': SHOWN },
			raised: [],
		},
		{
			name: 'a template by page ID',
			files: { 'page-#Classes': NOT_SHOWN },
			raised: [
				'page #Classes "Classes" with wp-content/themes/bakery/templates/page-#Classes.html',
			],
		},
		{
			name: 'a template the page is assigned',
			files: { 'page-plain': NOT_SHOWN },
			assigned: 'page-plain',
			raised: [ 'page #About "About" with wp-content/themes/bakery/templates/page-plain.html' ],
		},
		{
			name: 'page.html for every page but the posts page',
			files: { page: NOT_SHOWN },
			raised: [
				'page #Classes "Classes", page #About "About", page #Home "Home" with wp-content/themes/bakery/templates/page.html',
				'so their content never shows, and edits to them change nothing',
			],
			problems: 1,
		},
		{
			name: "the parent theme's index.html",
			parentFiles: { index: NOT_SHOWN },
			raised: [
				'page #Classes "Classes", page #About "About", page #Home "Home" with wp-content/themes/bakery-parent/templates/index.html',
			],
		},
		{
			name: 'a saved template before the theme file',
			files: { 'page-about': SHOWN },
			saved: { 'page-about': NOT_SHOWN },
			raised: [
				'page #About "About" with the page-about template saved in the Site Editor (post ',
			],
		},
		{
			name: 'the front page by its front-page template only',
			files: { 'front-page': NOT_SHOWN, page: SHOWN },
			raised: [ 'get_front_page_template' ],
		},
		{
			name: 'the front page by a front-page template with post-content',
			files: { 'front-page': SHOWN, page: NOT_SHOWN },
			raised: [ 'page #Classes "Classes", page #About "About" with' ],
		},
		// A plugin can query a page's request as an archive, as WooCommerce
		// queries its shop page as the products archive (WC_Query::pre_get_posts),
		// keeping the page as the queried object: the page does not show there
		// through post-content, whose post is the archive's.
		{
			name: 'a page a plugin queries as an archive',
			files: { archive: NOT_SHOWN, page: SHOWN },
			plugin: ARCHIVE_PAGE,
			raised: [],
		},
		{
			name: 'a page a plugin queries as an archive, beside a page without post-content',
			files: { archive: NOT_SHOWN, page: NOT_SHOWN },
			plugin: ARCHIVE_PAGE,
			raised: [
				'page #About "About", page #Home "Home" with wp-content/themes/bakery/templates/page.html',
			],
		},
		{
			name: 'the front page a plugin queries as an archive',
			files: { 'front-page': NOT_SHOWN },
			plugin: ARCHIVE_PAGE.replace( 'Classes', 'Home' ),
			raised: [],
		},
		// home.html renders at the posts index, which Settings → Reading may leave nowhere.
		{
			name: 'home.html with a static front page and no posts page',
			options: { show_on_front: 'page', page_on_front: '#Home' },
			files: { home: NOT_SHOWN },
			raised: [
				'WordPress renders wp-content/themes/bakery/templates/home.html at the posts index (get_home_template in wp-includes/template.php), and Settings → Reading shows page #Home "Home" at the front page (show_on_front, page_on_front) and names no posts page (page_for_posts), so it renders nowhere',
			],
		},
		{ name: 'home.html with a posts page', files: { home: NOT_SHOWN }, raised: [] },
		{
			name: 'home.html with a static front page naming no page',
			options: { show_on_front: 'page' },
			files: { home: NOT_SHOWN, 'front-page': SHOWN },
			raised: [],
		},
		{
			name: 'home.html with the latest posts on the front',
			options: {},
			files: { home: NOT_SHOWN },
			raised: [],
		},
		{
			name: 'home.html behind a front-page template',
			options: {},
			files: { home: NOT_SHOWN, 'front-page': SHOWN },
			raised: [
				'with wp-content/themes/bakery/templates/front-page.html, which WordPress renders there before home.html',
			],
		},
		{
			name: 'home.html of a theme WordPress updates',
			options: { show_on_front: 'page', page_on_front: '#Home' },
			parentFiles: { home: NOT_SHOWN },
			updatable: true,
			raised: [],
		},
		{
			name: 'a saved home template',
			options: { show_on_front: 'page', page_on_front: '#Home' },
			parentFiles: { home: NOT_SHOWN },
			saved: { home: NOT_SHOWN },
			updatable: true,
			raised: [ 'WordPress renders the home template saved in the Site Editor (post ' ],
		},
	] )(
		'$name',
		async ( { name, raised, problems: count, ...state } ) => {
			const problems = await run( state );
			expect( problems, name ).toHaveLength( count ?? raised.length );
			raised.forEach( ( text, index ) =>
				expect( problems[ count ? 0 : index ] ).toContain( withIds( text ) )
			);
		},
		60000
	);

	it( 'tells one page or several what to do', async () => {
		expect(
			await run( {
				options: {},
				files: { 'page-classes': NOT_SHOWN, page: NOT_SHOWN },
			} )
		).toEqual( [
			withIds(
				'WordPress renders page #Classes "Classes" with wp-content/themes/bakery/templates/page-classes.html (the page template hierarchy, get_page_template in wp-includes/template.php), which has no core/post-content block, the only block that renders the page shown (wp-includes/blocks/post-content.php), so its content never shows, and edits to it change nothing on the site. Put the content in the page, and render it with <!-- wp:post-content /--> in the template, or remove the template so page.html renders the page.'
			),
			withIds(
				'WordPress renders page #About "About", page #Journal "Journal", page #Home "Home" with wp-content/themes/bakery/templates/page.html (the page template hierarchy, get_page_template in wp-includes/template.php), which has no core/post-content block, the only block that renders the page shown (wp-includes/blocks/post-content.php), so their content never shows, and edits to them change nothing on the site. Put the content in each page, and render it with <!-- wp:post-content /--> in the template.'
			),
		] );
	}, 60000 );
} );
