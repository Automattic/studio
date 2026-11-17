import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it } from 'vitest';
import { filesUnder } from '@studio/agent/node/active-code';

let dir: string;
afterEach( () => rmSync( dir, { recursive: true, force: true } ) );

it( 'finds the files in every folder under it but a build’s dependencies', async () => {
	dir = mkdtempSync( path.join( os.tmpdir(), 'files-under-' ) );
	for ( const file of [
		'a.php',
		'b.css',
		'src/c.php',
		'src/blocks/hero/block.json',
		'node_modules/x/d.php',
	] ) {
		mkdirSync( path.dirname( path.join( dir, file ) ), { recursive: true } );
		writeFileSync( path.join( dir, file ), '' );
	}
	const found = await filesUnder( dir, ( name ) => ! name.endsWith( '.css' ) );
	expect(
		found.map( ( file ) => path.relative( dir, file ).split( path.sep ).join( '/' ) ).sort()
	).toEqual( [ 'a.php', 'src/blocks/hero/block.json', 'src/c.php' ] );
} );
