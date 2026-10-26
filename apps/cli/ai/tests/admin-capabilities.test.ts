import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminCapabilities } from 'cli/ai/admin-capabilities';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', async ( importOriginal ) => ( {
	runWpCliCommand: vi.fn(
		( await importOriginal< typeof import('cli/lib/run-wp-cli-command') >() ).runWpCliCommand
	),
} ) );

// A real WordPress install to resolve capabilities with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const plugin = ( init: string ) => `<?php
/**
 * Plugin Name: Reading list
 */
add_action( 'init', function () { ${ init } } );
`;

describe.runIf( WORDPRESS )(
	'the capabilities the site’s code takes from its administrator',
	() => {
		let site: SiteData;
		beforeEach( () => {
			const root = mkdtempSync( path.join( os.tmpdir(), 'admin-capabilities-' ) );
			cpSync( WORDPRESS!, root, { recursive: true } );
			site = { id: 'site', name: 'Reading Room', path: root } as SiteData;
		} );
		afterEach( () => rmSync( site.path, { recursive: true, force: true } ) );

		// Sets the active plugins, as WordPress keeps them in active_plugins.
		const setActive = async ( plugins: string[] ) => {
			const { DatabaseSync } = await import( 'node:sqlite' );
			const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ) );
			db.prepare(
				"UPDATE wp_options SET option_value = ? WHERE option_name = 'active_plugins'"
			).run(
				`a:${ plugins.length }:{${ plugins
					.map( ( plugin, i ) => `i:${ i };s:${ plugin.length }:"${ plugin }";` )
					.join( '' ) }}`
			);
			db.close();
		};
		const activate = async ( code: string, others: string[] = [] ) => {
			const dir = path.join( site.path, 'wp-content/plugins/reading-list' );
			mkdirSync( dir, { recursive: true } );
			writeFileSync( path.join( dir, 'reading-list.php' ), code );
			await setActive( [ 'reading-list/reading-list.php', ...others ] );
		};
		const reportOf = ( reports: Array< { key: string } >, key: string ) =>
			reports.find( ( report ) => report.key === key );

		it.each( [
			{
				name: 'a post type that names primitive capabilities as its meta capabilities',
				code: plugin(
					"register_post_type( 'book', array( 'public' => true, 'map_meta_cap' => true, 'capabilities' => array( 'edit_post' => 'edit_posts', 'read_post' => 'read', 'delete_post' => 'delete_posts' ) ) );"
				),
				problem: [
					"Reading Room: user_can() denies its administrator (user 1) edit_posts, read and delete_posts, which the administrator role grants and WordPress grants with the site's plugins and theme skipped; map_meta_cap() (wp-includes/capabilities.php) maps them to do_not_allow.",
					'Post type book names edit_posts as its edit_post, read as its read_post and delete_posts as its delete_post capability',
					'so WordPress checks those capabilities as the meta capabilities, which need a post (_post_type_meta_capabilities() in wp-includes/post.php).',
					"register_post_type()'s capability_type",
				],
				// A core post type that maps no meta capabilities is not named.
				absent: [ 'custom_css' ],
			},
			{
				name: 'a filter that takes a capability away',
				code: plugin(
					"add_filter( 'map_meta_cap', function ( $caps, $cap ) { return 'manage_options' === $cap ? array( 'do_not_allow' ) : $caps; }, 10, 2 );"
				),
				problem: [ '(user 1) manage_options, which', 'maps it to do_not_allow.' ],
				absent: [ 'Post type', 'capability_type' ],
			},
			{
				// As WooCommerce's install gives the administrator role edit_product.
				name: 'a role holding the meta capabilities a post type names from its capability_type',
				code: plugin(
					"register_post_type( 'product', array( 'public' => true, 'map_meta_cap' => true, 'capability_type' => 'product' ) ); get_role( 'administrator' )->add_cap( 'edit_product' ); get_role( 'administrator' )->add_cap( 'read_product' );"
				),
				problem: undefined,
			},
			{
				name: 'a post type with capabilities of its own',
				code: plugin(
					"register_post_type( 'book', array( 'public' => true, 'map_meta_cap' => true, 'capability_type' => 'book' ) );"
				),
				problem: undefined,
			},
		] )(
			'reports $name',
			async ( { code, problem, absent = [] } ) => {
				const before = await adminCapabilities.read( site.path );
				await activate( code );
				const after = await adminCapabilities.read( site.path );
				const { reports } = await adminCapabilities.check( site, before, after );
				const report = reports.find( ( r ) => r.key === 'administrator capabilities' );
				expect( report ).toBeDefined();
				if ( problem ) {
					for ( const text of problem ) {
						expect( report?.problem ).toContain( text );
					}
					for ( const text of absent ) {
						expect( report?.problem ).not.toContain( text );
					}
				} else {
					expect( report?.problem ).toBeUndefined();
				}
			},
			120000
		);

		describe( 'what the changed code registers', () => {
			const READING_LIST = plugin( `register_post_type( 'book', array( 'public' => true ) ); } );
add_action( 'rest_api_init', function () {
	register_rest_route( 'bookclub/v1', '/books', array( 'methods' => 'GET', 'callback' => '__return_empty_array', 'permission_callback' => '__return_true' ) );
} );
add_action( 'wp_abilities_api_categories_init', function () {
	wp_register_ability_category( 'bookclub', array( 'label' => 'Book club', 'description' => 'Books.' ) );
} );
add_action( 'wp_abilities_api_init', function () {
	wp_register_ability( 'bookclub/list-books', array( 'label' => 'List books', 'description' => 'Lists books.', 'category' => 'bookclub', 'execute_callback' => '__return_empty_array', 'permission_callback' => '__return_true' ) );` );

			it( 'states what each registry holds only with it loaded', async () => {
				// Akismet registers REST routes of its own, which are not the change's.
				await activate( plugin( '' ), [ 'akismet/akismet.php' ] );
				const before = await adminCapabilities.read( site.path );
				await activate( READING_LIST, [ 'akismet/akismet.php' ] );
				const after = await adminCapabilities.read( site.path );
				const { reports } = await adminCapabilities.check( site, before, after );
				expect( reportOf( reports, 'registered' ) ).toEqual( {
					key: 'registered',
					summary:
						'Reading Room: with plugin reading-list/reading-list.php loaded, WordPress registers post types book (register_post_type(); with show_in_rest false, out of the REST API: book); REST routes /bookclub/v1, /bookclub/v1/books (register_rest_route()); abilities bookclub/list-books (wp_register_ability(), in wp-includes/abilities-api.php; with meta show_in_rest false, so not listed by wp-includes/rest-api/endpoints/class-wp-rest-abilities-v1-list-controller.php, out of the REST API: bookclub/list-books); no taxonomies (register_taxonomy()), block types (register_block_type()) and shortcodes (add_shortcode()) of its own.',
				} );
			} );

			it( 'states it for a single-file plugin', async () => {
				await activate( READING_LIST, [ 'hello.php' ] );
				const before = await adminCapabilities.read( site.path );
				writeFileSync(
					path.join( site.path, 'wp-content/plugins/hello.php' ),
					"<?php\n/**\n * Plugin Name: Hello Dolly\n */\nadd_shortcode( 'dolly', '__return_empty_string' );\n"
				);
				const after = await adminCapabilities.read( site.path );
				const { reports } = await adminCapabilities.check( site, before, after );
				expect( reportOf( reports, 'registered' ) ).toEqual( {
					key: 'registered',
					summary: expect.stringMatching(
						/^Reading Room: with plugin hello\.php loaded, WordPress registers shortcodes dolly \(add_shortcode\(\)\); no post types/
					),
				} );
			} );

			it( 'states it for the active theme', async () => {
				await activate( plugin( '' ) );
				const before = await adminCapabilities.read( site.path );
				const functions = path.join(
					site.path,
					'wp-content/themes/twentytwentyfive/functions.php'
				);
				writeFileSync(
					functions,
					`${ readFileSync(
						functions,
						'utf8'
					) }\nadd_action( 'init', function () { register_taxonomy( 'course', 'post' ); } );\n`
				);
				const after = await adminCapabilities.read( site.path );
				const { reports } = await adminCapabilities.check( site, before, after );
				expect( reportOf( reports, 'registered' ) ).toEqual( {
					key: 'registered',
					summary: expect.stringMatching(
						/^Reading Room: with theme twentytwentyfive loaded, WordPress registers taxonomies course \(register_taxonomy\(\); with show_in_rest false, out of the REST API: course\); no post types/
					),
				} );
			} );

			it( 'names at most twelve of a registry, and every registry it adds to', async () => {
				const before = await adminCapabilities.read( site.path );
				await activate(
					READING_LIST.replace(
						"'execute_callback' => '__return_empty_array', 'permission_callback' => '__return_true' ) );",
						"'execute_callback' => '__return_empty_array', 'permission_callback' => '__return_true', 'meta' => array( 'show_in_rest' => true ) ) );"
					).replace(
						"register_post_type( 'book', array( 'public' => true ) );",
						`register_post_type( 'book', array( 'public' => true, 'show_in_rest' => true ) ); register_taxonomy( 'genre', 'book' ); register_block_type( 'bookclub/shelf', array( 'render_callback' => '__return_empty_string' ) ); foreach ( range( 1, 14 ) as $i ) { add_shortcode( "book$i", '__return_empty_string' ); }`
					)
				);
				const after = await adminCapabilities.read( site.path );
				const { reports } = await adminCapabilities.check( site, before, after );
				expect( reportOf( reports, 'registered' ) ).toEqual( {
					key: 'registered',
					summary:
						'Reading Room: with plugin reading-list/reading-list.php loaded, WordPress registers post types book (register_post_type()); taxonomies genre (register_taxonomy(); with show_in_rest false, out of the REST API: genre); REST routes /bookclub/v1, /bookclub/v1/books, /wp/v2/book, /wp/v2/book/(?P<id>[\\d]+), /wp/v2/book/(?P<id>[\\d]+)/autosaves, /wp/v2/book/(?P<parent>[\\d]+)/autosaves/(?P<id>[\\d]+) (register_rest_route()); block types bookclub/shelf (register_block_type()); abilities bookclub/list-books (wp_register_ability(), in wp-includes/abilities-api.php); shortcodes book1, book2, book3, book4, book5, book6, book7, book8, book9, book10, book11, book12 and 2 more (add_shortcode()).',
				} );
			} );

			it( 'states nothing when a plugin is only deactivated', async () => {
				await activate( READING_LIST, [ 'hello.php' ] );
				const before = await adminCapabilities.read( site.path );
				await setActive( [ 'reading-list/reading-list.php' ] );
				const after = await adminCapabilities.read( site.path );
				const { reports } = await adminCapabilities.check( site, before, after );
				expect( reports ).toEqual( [ { key: 'administrator capabilities', problem: undefined } ] );
			} );
		} );

		it( 'asks WordPress only when the active code changed', async () => {
			await activate( plugin( '' ) );
			const versions = await adminCapabilities.read( site.path );
			vi.mocked( runWpCliCommand ).mockClear();
			expect( await adminCapabilities.check( site, versions, versions ) ).toEqual( {
				reports: [],
			} );
			// A theme the site does not use is not its code.
			writeFileSync(
				path.join( site.path, 'wp-content/themes/twentytwentythree/functions.php' ),
				'<?php'
			);
			expect( await adminCapabilities.read( site.path ) ).toEqual( versions );
			// The active plugin's own file is.
			writeFileSync(
				path.join( site.path, 'wp-content/plugins/reading-list/reading-list.php' ),
				plugin( '// edited' )
			);
			expect( await adminCapabilities.read( site.path ) ).not.toEqual( versions );
			expect( runWpCliCommand ).not.toHaveBeenCalled();
		}, 120000 );
	}
);
