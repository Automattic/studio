import { cpSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { deleteInstallDefaults } from '@studio/agent/node/tools/create-site';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install, as `wp core install` left it, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'the placeholder content a new site starts without', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	beforeEach( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'install-defaults-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'New Site' );
		host = liveHost( site );
	} );
	afterEach( () => rmSync( site.path, { recursive: true, force: true } ) );

	const query = async ( sql: string ) => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ) );
		try {
			return db.prepare( sql ).all();
		} finally {
			db.close();
		}
	};
	const slugs = async () =>
		(
			( await query(
				"SELECT post_name FROM wp_posts WHERE post_type IN ( 'post', 'page' ) ORDER BY ID"
			) ) as Array< { post_name: string } >
		 ).map( ( post ) => post.post_name );

	it( 'deletes the Hello world! post, its comment and the Sample Page, and keeps the Privacy Policy draft', async () => {
		expect( await slugs() ).toEqual( [ 'hello-world', 'sample-page', 'privacy-policy' ] );
		expect( await query( 'SELECT comment_ID FROM wp_comments' ) ).toHaveLength( 1 );

		await deleteInstallDefaults( host, site );

		expect( await slugs() ).toEqual( [ 'privacy-policy' ] );
		expect( await query( 'SELECT comment_ID FROM wp_comments' ) ).toHaveLength( 0 );
		expect( await query( 'SELECT meta_id FROM wp_postmeta WHERE post_id IN ( 1, 2 )' ) ).toEqual(
			[]
		);
		expect(
			await query(
				"SELECT option_value FROM wp_options WHERE option_name = 'wp_page_for_privacy_policy'"
			)
		).toEqual( [ { option_value: '3' } ] );
	}, 120000 );

	it( 'keeps a Sample Page someone edited', async () => {
		const edit = await host.sites.wpCli( site, [
			'post',
			'update',
			'2',
			'--post_content=Our opening hours.',
		] );
		expect( edit.exitCode ).toBe( 0 );

		await deleteInstallDefaults( host, site );

		expect( await slugs() ).toEqual( [ 'sample-page', 'privacy-policy' ] );
	}, 120000 );
} );
