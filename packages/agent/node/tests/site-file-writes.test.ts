import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { siteFileWrites } from '@studio/agent/node/site-file-writes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import type { HostSite } from '@studio/agent/node/host';

const host = createFakeHost();

let site: string;

afterEach( () => {
	vi.unstubAllGlobals();
	rmSync( site, { recursive: true, force: true } );
} );

// WordPress.org updates only the theme named "released", as wp_update_themes() asks it.
const asked: string[] = [];
beforeEach( () => {
	asked.length = 0;
	vi.stubGlobal( 'fetch', async ( _url: string, init: { body: URLSearchParams } ) => {
		const { themes } = JSON.parse( init.body.get( 'themes' ) ?? '{}' );
		asked.push( ...Object.keys( themes ) );
		return Response.json( { themes: {}, no_update: 'released' in themes ? themes : {} } );
	} );
} );

function write( relativePath: string, content = '' ) {
	const file = path.join( site, relativePath );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, content );
	return file;
}

it( 'reports the files written since, outside core, the database, plugin code and dependencies', async () => {
	site = mkdtempSync( path.join( os.tmpdir(), 'studio-written-' ) );
	const style = write( 'wp-content/themes/t/style.css', 'a' );
	write( 'wp-content/themes/t/theme.json', '{}' );
	const before = await siteFileWrites.read( site, undefined, host );
	write( 'wp-content/themes/t/style.css', 'ab' );
	const page = write( 'tmp/page-home.html' );
	const draft = write( 'wp-content/uploads/home.tmp.html' );
	const notes = write( 'notes.md' );
	const silence = write( 'wp-content/themes/index.php', '<?php // Silence is golden.' );
	write( 'wp-content/plugins/p/p.php' );
	write( 'wp-content/mu-plugins/m.php' );
	write( 'wp-includes/version.php' );
	write( 'wp-content/database/.ht.sqlite' );
	write( 'wp-content/themes/t/node_modules/x/index.js' );
	write( 'wp-content/themes/t/.git/HEAD' );
	const { reports } = await siteFileWrites.check(
		{ path: site } as HostSite,
		before,
		await siteFileWrites.read( site, undefined, host ),
		host
	);
	expect( reports.map( ( report ) => report.written ).sort() ).toEqual(
		[ style, page, draft, notes, silence ].sort()
	);
	// Only the folders of themes are themes WordPress may update.
	expect( asked ).toEqual( [ 't' ] );
} );

it( 'leaves the files of a theme WordPress updates, which its release wrote', async () => {
	site = mkdtempSync( path.join( os.tmpdir(), 'studio-written-' ) );
	const before = await siteFileWrites.read( site, undefined, host );
	// As `wp theme install released` writes them, beside a theme of the site's own.
	write( 'wp-content/themes/released/style.css', '/*\nTheme Name: Released\nVersion: 1.0\n*/' );
	write( 'wp-content/themes/released/patterns/hero.php', '<!-- wp:button /-->' );
	const own = write( 'wp-content/themes/own/style.css', '/*\nTheme Name: Own\nVersion: 1.0\n*/' );
	const { reports } = await siteFileWrites.check(
		{ path: site } as HostSite,
		before,
		await siteFileWrites.read( site, undefined, host ),
		host
	);
	expect( reports.map( ( report ) => report.written ) ).toEqual( [ own ] );
} );
