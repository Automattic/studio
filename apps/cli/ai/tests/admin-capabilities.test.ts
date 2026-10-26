import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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

		const activate = async ( code: string ) => {
			const dir = path.join( site.path, 'wp-content/plugins/reading-list' );
			mkdirSync( dir, { recursive: true } );
			writeFileSync( path.join( dir, 'reading-list.php' ), code );
			const { DatabaseSync } = await import( 'node:sqlite' );
			const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ) );
			db.prepare(
				"UPDATE wp_options SET option_value = ? WHERE option_name = 'active_plugins'"
			).run( 'a:1:{i:0;s:29:"reading-list/reading-list.php";}' );
			db.close();
		};

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
				expect( reports ).toHaveLength( 1 );
				if ( problem ) {
					for ( const text of problem ) {
						expect( reports[ 0 ].problem ).toContain( text );
					}
					for ( const text of absent ) {
						expect( reports[ 0 ].problem ).not.toContain( text );
					}
				} else {
					expect( reports[ 0 ].problem ).toBeUndefined();
				}
			},
			120000
		);

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
