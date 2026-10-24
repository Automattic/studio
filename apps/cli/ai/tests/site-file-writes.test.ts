import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it } from 'vitest';
import { siteFileWrites } from 'cli/ai/site-file-writes';
import type { SiteData } from 'cli/lib/cli-config/core';

let site: string;

afterEach( () => rmSync( site, { recursive: true, force: true } ) );

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
	const before = await siteFileWrites.read( site );
	write( 'wp-content/themes/t/style.css', 'ab' );
	const page = write( 'tmp/page-home.html' );
	const draft = write( 'wp-content/uploads/home.tmp.html' );
	const notes = write( 'notes.md' );
	write( 'wp-content/plugins/p/p.php' );
	write( 'wp-content/mu-plugins/m.php' );
	write( 'wp-includes/version.php' );
	write( 'wp-content/database/.ht.sqlite' );
	write( 'wp-content/themes/t/node_modules/x/index.js' );
	write( 'wp-content/themes/t/.git/HEAD' );
	const { reports } = await siteFileWrites.check(
		{} as SiteData,
		before,
		await siteFileWrites.read( site )
	);
	expect( reports.map( ( report ) => report.written ).sort() ).toEqual(
		[ style, page, draft, notes ].sort()
	);
} );
