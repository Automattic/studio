import assert from 'node:assert/strict';
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'vitest';
import { replaceVendoredTree } from './sync-data-liberation-agent.mjs';

const scratchDirs = [];

function scratch() {
	const dir = mkdtempSync( path.join( tmpdir(), 'sync-dla-test-' ) );
	scratchDirs.push( dir );
	return dir;
}

afterEach( () => {
	while ( scratchDirs.length ) {
		rmSync( scratchDirs.pop(), { recursive: true, force: true } );
	}
} );

test( 'replaceVendoredTree keeps upstream relative symlinks relative', () => {
	const source = scratch();
	writeFileSync( path.join( source, 'AGENTS.md' ), 'guidance\n' );
	symlinkSync( 'AGENTS.md', path.join( source, 'CLAUDE.md' ) );

	const destination = path.join( scratch(), 'vendored' );
	replaceVendoredTree( source, destination );

	// The vendored link must not point back into the throwaway clone directory,
	// which is deleted as soon as the sync finishes.
	assert.equal( readlinkSync( path.join( destination, 'CLAUDE.md' ) ), 'AGENTS.md' );
	assert.equal( readFileSync( path.join( destination, 'CLAUDE.md' ), 'utf8' ), 'guidance\n' );
} );

test( 'replaceVendoredTree copies nested files verbatim', () => {
	const source = scratch();
	mkdirSync( path.join( source, 'src', 'lib' ), { recursive: true } );
	writeFileSync( path.join( source, 'src', 'lib', 'capture.ts' ), 'export const a = 1;\n' );

	const destination = path.join( scratch(), 'vendored' );
	replaceVendoredTree( source, destination );

	assert.equal(
		readFileSync( path.join( destination, 'src', 'lib', 'capture.ts' ), 'utf8' ),
		'export const a = 1;\n'
	);
} );

test( 'replaceVendoredTree removes files that upstream no longer ships', () => {
	const source = scratch();
	writeFileSync( path.join( source, 'kept.ts' ), 'kept\n' );

	const destination = path.join( scratch(), 'vendored' );
	mkdirSync( destination, { recursive: true } );
	writeFileSync( path.join( destination, 'removed-upstream.ts' ), 'stale\n' );

	replaceVendoredTree( source, destination );

	assert.equal( readFileSync( path.join( destination, 'kept.ts' ), 'utf8' ), 'kept\n' );
	assert.throws( () => readFileSync( path.join( destination, 'removed-upstream.ts' ) ) );
} );
