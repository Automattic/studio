import { cpSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { globalStylesFlag } from '@studio/agent/node/global-styles-flag';
import { runWpCli } from '@studio/agent/node/tools/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { StudioAgentHost } from '@studio/agent/node';

// A real WordPress install, on Twenty Twenty-Five, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'globalStylesFlag', () => {
	let root: string;
	const site = () => liveSite( root, 'Site' );
	let host: StudioAgentHost;
	const sql = async ( query: string, ...params: Array< string | number > ) => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		try {
			db.prepare( query ).run( ...params );
		} finally {
			db.close();
		}
	};
	beforeEach( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'global-styles-flag-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		host = liveHost( site() );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'saves Global Styles WordPress ignores through the REST route, so WordPress applies them', async () => {
		const before = await globalStylesFlag.read( root, undefined, host );
		// Global Styles saved as `wp post update` saves them, without the flag.
		await sql(
			`INSERT INTO wp_posts ( ID, post_author, post_type, post_status, post_name, post_title, post_content, post_date, post_date_gmt, post_modified, post_modified_gmt, post_excerpt, to_ping, pinged, post_content_filtered ) VALUES ( 900, 1, 'wp_global_styles', 'publish', 'wp-global-styles-twentytwentyfive', 'Custom Styles', ?, '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '', '', '', '' )`,
			'{"version":3,"styles":{"color":{"background":"#f8f7f5"}}}'
		);
		const unflagged = await globalStylesFlag.read( root, undefined, host );
		expect( unflagged[ 900 ] ).toMatch( /^unthemed:unflagged:/ );
		// A post a call did not change is the one an earlier call reported.
		expect(
			( await globalStylesFlag.check( site(), unflagged, unflagged, host ) ).reports
		).toEqual( [] );
		const { reports } = await globalStylesFlag.check( site(), before, unflagged, host );
		expect( reports ).toEqual( [
			{
				key: 'global styles theme 900',
				summary: expect.stringContaining( 'Studio gave it the active theme' ),
			},
			{
				key: 'global styles 900',
				summary: expect.stringContaining(
					'Studio saved its settings and styles through that route'
				),
			},
		] );
		// Sanitized, flagged, and its styles kept.
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		const { post_content: content } = db
			.prepare( 'SELECT post_content FROM wp_posts WHERE ID = 900' )
			.get() as { post_content: string };
		db.close();
		expect( JSON.parse( content ) ).toMatchObject( {
			isGlobalStylesUserThemeJSON: true,
			styles: { color: { background: '#f8f7f5' } },
		} );
		// Saved, it is not saved again.
		const saved = await globalStylesFlag.read( root, undefined, host );
		expect( saved[ 900 ] ).not.toMatch( /unflagged:/ );
		expect( ( await globalStylesFlag.check( site(), unflagged, saved, host ) ).reports ).toEqual(
			[]
		);
	}, 60000 );

	// The background WordPress applies, and the Global Styles post it reads.
	const applied = async () =>
		JSON.parse(
			await runWpCli( host, site(), [
				'eval',
				"echo wp_json_encode( array( wp_get_global_styles( array( 'color', 'background' ) ), WP_Theme_JSON_Resolver::get_user_global_styles_post_id() ) );",
			] )
		) as [ string, number ];

	it( 'gives Global Styles saved with no theme the active theme, so WordPress applies them', async () => {
		const before = await globalStylesFlag.read( root, undefined, host );
		// As core's own get_user_data_from_wp_global_styles( …, true ) saves the post under `wp eval`: no user, so no term.
		const id = Number(
			await runWpCli( host, site(), [
				'eval',
				"$id = WP_Theme_JSON_Resolver::get_user_global_styles_post_id(); wp_update_post( array( 'ID' => $id, 'post_content' => wp_json_encode( array( 'version' => 3, 'isGlobalStylesUserThemeJSON' => true, 'styles' => array( 'color' => array( 'background' => '#f8f7f5' ) ) ) ) ) ); echo $id;",
			] )
		);
		// Reading Global Styles while the post names no theme makes core save another, empty one.
		expect( ( await applied() )[ 0 ] ).not.toBe( '#f8f7f5' );
		const after = await globalStylesFlag.read( root, undefined, host );
		expect( ( await globalStylesFlag.check( site(), before, after, host ) ).reports ).toEqual( [
			{
				key: `global styles theme ${ id }`,
				summary: expect.stringContaining( 'Studio gave it the active theme, twentytwentyfive' ),
			},
		] );
		expect( await applied() ).toEqual( [ '#f8f7f5', id ] );

		// A second post with no theme, once the theme has one WordPress reads, is named, not given the theme: newer, it would replace the first.
		await sql(
			`INSERT INTO wp_posts ( ID, post_author, post_type, post_status, post_name, post_title, post_content, post_date, post_date_gmt, post_modified, post_modified_gmt, post_excerpt, to_ping, pinged, post_content_filtered ) VALUES ( 901, 1, 'wp_global_styles', 'publish', 'wp-global-styles-twentytwentyfive-2', 'Custom Styles', ?, '2030-01-01', '2030-01-01', '2030-01-01', '2030-01-01', '', '', '', '' )`,
			'{"version":3,"isGlobalStylesUserThemeJSON":true,"styles":{"color":{"background":"#000000"}}}'
		);
		const second = await globalStylesFlag.read( root, undefined, host );
		expect( ( await globalStylesFlag.check( site(), after, second, host ) ).reports ).toEqual( [
			{
				key: 'global styles 901',
				problem: expect.stringContaining(
					`for twentytwentyfive that is post ${ id }. Make the change there`
				),
			},
		] );
		expect( await applied() ).toEqual( [ '#f8f7f5', id ] );
	}, 60000 );
} );
