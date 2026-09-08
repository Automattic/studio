import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publishSite, resolvePublishDirectory } from './publish.js';

const dirs: string[] = [];
afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

function liberatedRun(): string {
	const dir = mkdtempSync( join( tmpdir(), 'dla-publish-ui-' ) );
	dirs.push( dir );
	mkdirSync( join( dir, 'website' ), { recursive: true } );
	writeFileSync( join( dir, 'website', 'index.html' ), '<h1>Home</h1>' );
	writeFileSync( join( dir, 'capture-receipt.json' ), '{}' );
	return dir;
}

describe( 'resolvePublishDirectory', () => {
	it( 'publishes website/ when handed the liberated run directory', () => {
		const run = liberatedRun();
		expect( resolvePublishDirectory( run ) ).toBe( join( run, 'website' ) );
	} );

	it( 'publishes a plain directory as-is', () => {
		const run = liberatedRun();
		expect( resolvePublishDirectory( join( run, 'website' ) ) ).toBe( join( run, 'website' ) );
	} );

	it( 'rejects a path that is not a directory', () => {
		const run = liberatedRun();
		expect( () => resolvePublishDirectory( join( run, 'capture-receipt.json' ) ) ).toThrow(
			'Not a directory'
		);
	} );
} );

describe( 'publishSite', () => {
	it( 'rejects an unknown target and names the ones that exist', async () => {
		await expect(
			publishSite( { directory: liberatedRun(), target: 'nowhere' } )
		).rejects.toThrow( /Unknown publish target "nowhere"\. Available: spacefast\./ );
	} );
} );
