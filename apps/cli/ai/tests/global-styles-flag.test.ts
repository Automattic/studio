import { cpSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalStylesFlag } from 'cli/ai/global-styles-flag';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );

// A real WordPress install, on Twenty Twenty-Five, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'globalStylesFlag', () => {
	let root: string;
	const site = () => ( { id: 'site', name: 'Site', path: root } ) as SiteData;
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
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'saves Global Styles WordPress ignores through the REST route, so WordPress applies them', async () => {
		const before = await globalStylesFlag.read( root );
		// Global Styles saved as `wp post update` saves them, without the flag.
		await sql(
			`INSERT INTO wp_posts ( ID, post_author, post_type, post_status, post_name, post_title, post_content, post_date, post_date_gmt, post_modified, post_modified_gmt, post_excerpt, to_ping, pinged, post_content_filtered ) VALUES ( 900, 1, 'wp_global_styles', 'publish', 'wp-global-styles-twentytwentyfive', 'Custom Styles', ?, '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '', '', '', '' )`,
			'{"version":3,"styles":{"color":{"background":"#f8f7f5"}}}'
		);
		const unflagged = await globalStylesFlag.read( root );
		expect( unflagged[ 900 ] ).toMatch( /^unflagged:/ );
		// A post a call did not change is the one an earlier call reported.
		expect( ( await globalStylesFlag.check( site(), unflagged, unflagged ) ).reports ).toEqual(
			[]
		);
		const { reports } = await globalStylesFlag.check( site(), before, unflagged );
		expect( reports ).toEqual( [
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
		const saved = await globalStylesFlag.read( root );
		expect( saved[ 900 ] ).not.toMatch( /^unflagged:/ );
		expect( ( await globalStylesFlag.check( site(), unflagged, saved ) ).reports ).toEqual( [] );
	}, 60000 );
} );
