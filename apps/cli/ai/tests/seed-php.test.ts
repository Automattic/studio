import { describe, expect, it } from 'vitest';
import { buildSeederPhp, parseSeederResult } from 'cli/ai/generation/seed-php';

describe( 'parseSeederResult', () => {
	it( 'parses the seeder JSON output', () => {
		const out = JSON.stringify( {
			created: [ 'page:home', 'ember_menu_items:octopus' ],
			updated: [],
			failed: [],
			homeId: 42,
			frontSet: true,
		} );
		expect( parseSeederResult( out ) ).toEqual( {
			created: [ 'page:home', 'ember_menu_items:octopus' ],
			updated: [],
			failed: [],
			homeId: 42,
			frontSet: true,
		} );
	} );

	it( 'extracts the JSON even with surrounding WP notices', () => {
		const out =
			'PHP Notice: something\n' +
			JSON.stringify( {
				created: [ 'page:home' ],
				updated: [],
				failed: [],
				homeId: 7,
				frontSet: false,
			} ) +
			'\n';
		const parsed = parseSeederResult( out );
		expect( parsed.created ).toEqual( [ 'page:home' ] );
		expect( parsed.homeId ).toBe( 7 );
		expect( parsed.frontSet ).toBe( false );
	} );

	it( 'returns safe defaults on unparseable output', () => {
		expect( parseSeederResult( 'Fatal error: boom' ) ).toEqual( {
			created: [],
			updated: [],
			failed: [],
			homeId: 0,
			frontSet: false,
		} );
	} );
} );

describe( 'buildSeederPhp', () => {
	it( 'emits a single-pass PHP seeder using core insert/meta/option APIs', () => {
		const php = buildSeederPhp();
		expect( php.startsWith( '<?php' ) ).toBe( true );
		for ( const needle of [
			'wp_insert_post',
			'update_post_meta',
			'get_posts',
			"update_option( 'show_on_front'",
			"update_option( 'page_on_front'",
			'json_encode',
			'_seed-manifest.json',
		] ) {
			expect( php ).toContain( needle );
		}
	} );
} );
