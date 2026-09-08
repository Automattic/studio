import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createZipArchive, crc32 } from './zip.js';

const dirs: string[] = [];
afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

/**
 * Extract with Python's `zipfile` rather than Info-ZIP: it is a strict,
 * correct reader, and the `unzip` shipped on macOS mangles UTF-8 entry names,
 * which would test that tool's age instead of this writer.
 */
function extractWithPythonZipfile( archive: Buffer ): string {
	const dir = mkdtempSync( join( tmpdir(), 'dla-zip-' ) );
	dirs.push( dir );
	const archivePath = join( dir, 'archive.zip' );
	writeFileSync( archivePath, archive );
	const out = join( dir, 'out' );
	mkdirSync( out, { recursive: true } );
	execFileSync( 'python3', [
		'-c',
		[
			'import sys, zipfile',
			'z = zipfile.ZipFile(sys.argv[1])',
			// testzip() returns the first corrupt entry, so a bad CRC fails loudly.
			'bad = z.testzip()',
			'assert bad is None, f"corrupt entry: {bad}"',
			'z.extractall(sys.argv[2])',
		].join( '\n' ),
		archivePath,
		out,
	] );
	return out;
}

describe( 'createZipArchive', () => {
	it( 'produces an archive the system unzip reads back byte for byte', () => {
		// Compressible, incompressible, nested, and unicode payloads in one archive:
		// each exercises a different branch of the writer.
		const compressible = Buffer.from( 'a'.repeat( 5000 ) );
		const incompressible = Buffer.from( 'x' );
		const nested = Buffer.from( '<h1>About</h1>' );
		const unicode = Buffer.from( 'café — ünïcode', 'utf8' );

		const out = extractWithPythonZipfile(
			createZipArchive( [
				{ path: 'index.html', contents: compressible },
				{ path: 'tiny.txt', contents: incompressible },
				{ path: 'blog/post/about.html', contents: nested },
				{ path: 'assets/café.txt', contents: unicode },
			] )
		);

		expect( readFileSync( join( out, 'index.html' ) ).equals( compressible ) ).toBe( true );
		expect( readFileSync( join( out, 'tiny.txt' ) ).equals( incompressible ) ).toBe( true );
		expect( readFileSync( join( out, 'blog/post/about.html' ) ).equals( nested ) ).toBe( true );
		expect( readFileSync( join( out, 'assets/café.txt' ) ).equals( unicode ) ).toBe( true );
	} );

	it( 'is byte-identical across runs so publishing identical content stays a no-op', () => {
		const entries = [ { path: 'index.html', contents: Buffer.from( '<h1>Home</h1>' ) } ];
		expect( createZipArchive( entries ).equals( createZipArchive( entries ) ) ).toBe( true );
	} );

	it( 'rejects paths that escape the archive', () => {
		expect( () =>
			createZipArchive( [ { path: '../escape.html', contents: Buffer.from( 'x' ) } ] )
		).toThrow( 'escapes the archive' );
	} );

	it( 'computes the CRC-32 of a known vector', () => {
		expect( crc32( Buffer.from( '123456789' ) ) ).toBe( 0xcbf43926 );
	} );
} );
