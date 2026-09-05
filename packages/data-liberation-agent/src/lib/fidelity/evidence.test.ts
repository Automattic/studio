import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { writePixelEvidence } from './evidence.js';

const dirs: string[] = [];
afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

function png( width: number, height: number, fill: [ number, number, number, number ] ): Buffer {
	const image = new PNG( { width, height } );
	for ( let i = 0; i < image.data.length; i += 4 ) {
		image.data[ i ] = fill[ 0 ]!;
		image.data[ i + 1 ] = fill[ 1 ]!;
		image.data[ i + 2 ] = fill[ 2 ]!;
		image.data[ i + 3 ] = fill[ 3 ]!;
	}
	return PNG.sync.write( image );
}

describe( 'writePixelEvidence', () => {
	it( 'writes the pair and a diff, and scores identical shots as 1', () => {
		const dir = mkdtempSync( join( tmpdir(), 'dla-evidence-' ) );
		dirs.push( dir );
		const shot = png( 8, 8, [ 0, 0, 0, 255 ] );
		const result = writePixelEvidence( dir, shot, shot );
		expect( result ).toMatchObject( { score: 1 } );
		if ( 'diffPath' in result ) expect( readFileSync( result.diffPath ).length ).toBeGreaterThan( 0 );
	} );

	it( 'scores a total mismatch below 1 without throwing', () => {
		const dir = mkdtempSync( join( tmpdir(), 'dla-evidence-' ) );
		dirs.push( dir );
		const result = writePixelEvidence(
			dir,
			png( 8, 8, [ 0, 0, 0, 255 ] ),
			png( 8, 8, [ 255, 255, 255, 255 ] )
		);
		expect( 'score' in result && result.score ).toBeLessThan( 1 );
	} );
} );
