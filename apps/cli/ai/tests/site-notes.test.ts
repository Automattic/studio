import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { writtenFiles } from 'cli/ai/site-notes';

let site: string;

afterEach( () => rmSync( site, { recursive: true, force: true } ) );

function write( relativePath: string, content = '' ) {
	const file = path.join( site, relativePath );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, content );
	return file;
}

describe( 'writtenFiles', () => {
	it( 'lists the theme and tmp files written since, and none of the rest', async () => {
		site = mkdtempSync( path.join( os.tmpdir(), 'studio-written-' ) );
		const style = write( 'wp-content/themes/t/style.css', 'a' );
		write( 'wp-content/themes/t/theme.json', '{}' );
		const written = await writtenFiles( [ site ] );
		write( 'wp-content/themes/t/style.css', 'ab' );
		const page = write( 'tmp/page-home.html' );
		write( 'wp-content/plugins/p/p.php' );
		write( 'wp-content/themes/t/node_modules/x/index.js' );
		expect( ( await written() ).sort() ).toEqual( [ style, page ].sort() );
	} );
} );
