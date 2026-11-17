import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';

// A real WordPress install, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'WP-CLI commands changing plugins on one site', () => {
	let root: string;
	beforeEach( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'plugin-lock-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		// Plugins whose activation takes a while, as WooCommerce's creating its tables does.
		for ( const slug of [ 'slow-a', 'slow-b' ] ) {
			mkdirSync( path.join( root, 'wp-content/plugins', slug ), { recursive: true } );
			writeFileSync(
				path.join( root, 'wp-content/plugins', slug, `${ slug }.php` ),
				`<?php\n/* Plugin Name: ${ slug } */\nregister_activation_hook( __FILE__, function () { sleep( 2 ); } );\n`
			);
		}
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'keeps both activations of two run side by side', async () => {
		const site = liveSite( root, 'Site' );
		const host = liveHost( site );
		const wp = async ( ...args: string[] ) => ( await host.sites.wpCli( site, args ) ).stdout;
		await Promise.all( [
			wp( 'plugin', 'activate', 'slow-a' ),
			wp( 'plugin', 'activate', 'slow-b' ),
		] );
		expect(
			( await wp( 'plugin', 'list', '--status=active', '--field=name' ) ).trim().split( '\n' )
		).toEqual( expect.arrayContaining( [ 'slow-a', 'slow-b' ] ) );
	}, 120000 );
} );
