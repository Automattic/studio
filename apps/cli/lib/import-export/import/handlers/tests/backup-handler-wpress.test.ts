/**
 * Tests for the path traversal (Wpress Slip) fix in BackupHandlerWpress.
 *
 * Run with:
 *   npm test -- backup-handler-wpress
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BackupHandlerWpress } from '../backup-handler-wpress';

// ── .wpress builder ──────────────────────────────────────────────────────────

const HEADER_SIZE = 4377;

function makeHeader( name: string, size: number, prefix: string ): Buffer {
	const h = Buffer.alloc( HEADER_SIZE );
	h.write( name, 0, 'utf8' );
	h.write( String( size ), 255, 'utf8' );
	h.write( '0', 269, 'utf8' );
	h.write( prefix, 281, 'utf8' );
	return h;
}

function buildWpress( entries: { name: string; prefix: string; content: string }[] ): Buffer {
	const parts: Buffer[] = [];
	for ( const { name, prefix, content } of entries ) {
		const data = Buffer.from( content, 'utf8' );
		parts.push( makeHeader( name, data.length, prefix ) );
		parts.push( data );
	}
	parts.push( Buffer.alloc( HEADER_SIZE ) ); // EOF marker
	return Buffer.concat( parts );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe( 'BackupHandlerWpress — path traversal protection', () => {
	let tmpDir: string;
	let extractDir: string;
	let archivePath: string;
	let handler: BackupHandlerWpress;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wpress-test-' ) );
		extractDir = path.join( tmpDir, 'extract' );
		archivePath = path.join( tmpDir, 'test.wpress' );
		fs.mkdirSync( extractDir );
		handler = new BackupHandlerWpress();
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'blocks a traversal entry with prefix=".."', async () => {
		fs.writeFileSync(
			archivePath,
			buildWpress( [
				{ name: 'traversal-marker.txt', prefix: '..', content: 'should not land here\n' },
			] )
		);

		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );

		// Must NOT appear one level above the extraction dir
		expect( fs.existsSync( path.join( tmpDir, 'traversal-marker.txt' ) ) ).toBe( false );
	} );

	it( 'blocks a deep traversal targeting a specific path', async () => {
		fs.writeFileSync(
			archivePath,
			buildWpress( [
				{ name: 'authorized_keys', prefix: '../../../.ssh', content: 'ssh-rsa AAAA...\n' },
			] )
		);

		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );

		expect( fs.existsSync( path.join( tmpDir, '.ssh', 'authorized_keys' ) ) ).toBe( false );
	} );

	it( 'extracts a safe entry that follows a blocked traversal entry', async () => {
		fs.writeFileSync(
			archivePath,
			buildWpress( [
				{ name: 'evil.txt', prefix: '..', content: 'bad\n' },
				{ name: 'safe-file.txt', prefix: '', content: 'good\n' },
			] )
		);

		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );

		expect( fs.existsSync( path.join( extractDir, 'safe-file.txt' ) ) ).toBe( true );
	} );

	it( 'extracts all files from a legitimate archive', async () => {
		fs.writeFileSync(
			archivePath,
			buildWpress( [
				{ name: 'db.sql', prefix: '', content: '-- dump\n' },
				{ name: 'photo.jpg', prefix: 'wp-content/uploads', content: 'img data' },
				{ name: 'my-plugin.php', prefix: 'wp-content/plugins/my-plugin', content: '<?php // ok' },
			] )
		);

		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );

		expect( fs.existsSync( path.join( extractDir, 'db.sql' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( extractDir, 'wp-content', 'uploads', 'photo.jpg' ) ) ).toBe(
			true
		);
		expect(
			fs.existsSync(
				path.join( extractDir, 'wp-content', 'plugins', 'my-plugin', 'my-plugin.php' )
			)
		).toBe( true );
	} );
} );

describe( 'BackupHandlerWpress — listFiles traversal filtering', () => {
	let tmpDir: string;
	let archivePath: string;
	let handler: BackupHandlerWpress;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wpress-list-test-' ) );
		archivePath = path.join( tmpDir, 'test.wpress' );
		handler = new BackupHandlerWpress();
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'excludes traversal entries from the file list', async () => {
		fs.writeFileSync(
			archivePath,
			buildWpress( [
				{ name: 'traversal-marker.txt', prefix: '..', content: 'bad\n' },
				{ name: 'database.sql', prefix: '', content: '-- ok\n' },
			] )
		);

		const files = await handler.listFiles( { path: archivePath, type: 'wpress' } );

		expect( files.some( ( f ) => f.includes( '..' ) ) ).toBe( false );
		expect( files ).toContain( 'database.sql' );
	} );
} );

// ── Large archives and damaged archives ─────────────────────────────────────

const TWO_GIB = 2 ** 31;

/**
 * Writes a .wpress archive whose entries can be much larger than the bytes
 * actually stored on disk. Entry content that is not provided is left as a
 * hole (a sparse region), so a multi-gigabyte entry costs a few kilobytes.
 * The archive is finished with `ftruncate`, which never writes data, so it
 * stays sparse on every platform; the reader treats a clean end of file like
 * the EOF marker.
 */
function writeSparseWpress(
	archivePath: string,
	entries: { name: string; prefix: string; size: number; content?: Buffer }[],
	options: { withEofMarker?: boolean } = {}
): void {
	const fd = fs.openSync( archivePath, 'w' );
	try {
		let position = 0;
		for ( const entry of entries ) {
			fs.writeSync(
				fd,
				makeHeader( entry.name, entry.size, entry.prefix ),
				0,
				HEADER_SIZE,
				position
			);
			position += HEADER_SIZE;
			if ( entry.content ) {
				fs.writeSync( fd, entry.content, 0, entry.content.length, position );
			}
			position += entry.size;
		}
		if ( options.withEofMarker ) {
			fs.writeSync( fd, Buffer.alloc( HEADER_SIZE ), 0, HEADER_SIZE, position );
			position += HEADER_SIZE;
		}
		fs.ftruncateSync( fd, position );
	} finally {
		fs.closeSync( fd );
	}
}

/** Deterministic pseudo-random bytes, so content corruption is detectable. */
function pseudoRandomBytes( length: number, seed = 1 ): Buffer {
	const buffer = Buffer.alloc( length );
	let state = seed >>> 0;
	for ( let i = 0; i < length; i++ ) {
		// xorshift32
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		buffer[ i ] = state & 0xff;
	}
	return buffer;
}

describe( 'BackupHandlerWpress — entries larger than 2 GiB', () => {
	let tmpDir: string;
	let extractDir: string;
	let archivePath: string;
	let handler: BackupHandlerWpress;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wpress-large-test-' ) );
		extractDir = path.join( tmpDir, 'extract' );
		archivePath = path.join( tmpDir, 'large.wpress' );
		fs.mkdirSync( extractDir );
		handler = new BackupHandlerWpress();
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'lists every entry of an archive containing an entry larger than 2 GiB', async () => {
		writeSparseWpress( archivePath, [
			{ name: 'database.sql', prefix: '', size: 6, content: Buffer.from( '-- ok\n' ) },
			{ name: 'package.json', prefix: '', size: 2, content: Buffer.from( '{}' ) },
			{ name: 'backup.mp4', prefix: 'uploads', size: TWO_GIB + 4096 },
		] );
		expect( fs.statSync( archivePath ).size ).toBeGreaterThan( TWO_GIB );

		const files = await handler.listFiles( { path: archivePath, type: 'wpress' } );

		expect( files ).toEqual( [
			'database.sql',
			'package.json',
			path.join( 'uploads', 'backup.mp4' ),
		] );
	} );

	it( 'skips a blocked traversal entry larger than 2 GiB without reading it', async () => {
		writeSparseWpress( archivePath, [
			{ name: 'safe.txt', prefix: '', size: 5, content: Buffer.from( 'good\n' ) },
			{ name: 'huge-evil.bin', prefix: '..', size: TWO_GIB + 512 },
		] );

		const started = Date.now();
		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );

		expect( fs.readFileSync( path.join( extractDir, 'safe.txt' ), 'utf8' ) ).toBe( 'good\n' );
		expect( fs.existsSync( path.join( tmpDir, 'huge-evil.bin' ) ) ).toBe( false );
		// Skipping by position is O(1); reading 2 GiB of holes would take seconds.
		expect( Date.now() - started ).toBeLessThan( 2000 );
	} );

	it.skipIf( process.platform === 'win32' )(
		'keeps the test archive sparse (documents that the fixture really is > 2 GiB)',
		() => {
			writeSparseWpress( archivePath, [
				{ name: 'backup.mp4', prefix: 'uploads', size: TWO_GIB + 4096 },
			] );
			const stat = fs.statSync( archivePath );
			expect( stat.size ).toBeGreaterThan( TWO_GIB );
			// Allocated blocks are 512 bytes each; the header plus metadata is well under 1 MiB.
			expect( stat.blocks * 512 ).toBeLessThan( 1024 * 1024 );
		}
	);
} );

describe( 'BackupHandlerWpress — content integrity across chunk boundaries', () => {
	let tmpDir: string;
	let extractDir: string;
	let archivePath: string;
	let handler: BackupHandlerWpress;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wpress-content-test-' ) );
		extractDir = path.join( tmpDir, 'extract' );
		archivePath = path.join( tmpDir, 'content.wpress' );
		fs.mkdirSync( extractDir );
		handler = new BackupHandlerWpress();
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'extracts multi-chunk entries byte for byte and keeps following entries aligned', async () => {
		// 3 MiB plus a remainder that is not a multiple of the read chunk size.
		const big = pseudoRandomBytes( 3 * 1024 * 1024 + 777, 42 );
		const after = Buffer.from( 'after the big one\n' );
		writeSparseWpress(
			archivePath,
			[
				{ name: 'video.mp4', prefix: 'uploads/2026/09', size: big.length, content: big },
				{ name: 'notes.txt', prefix: '', size: after.length, content: after },
			],
			{ withEofMarker: true }
		);

		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );

		const extracted = fs.readFileSync(
			path.join( extractDir, 'uploads', '2026', '09', 'video.mp4' )
		);
		expect( extracted.length ).toBe( big.length );
		expect( extracted.equals( big ) ).toBe( true );
		expect( fs.readFileSync( path.join( extractDir, 'notes.txt' ), 'utf8' ) ).toBe(
			'after the big one\n'
		);
	} );

	it( 'extracts an empty entry as an empty file', async () => {
		writeSparseWpress( archivePath, [ { name: 'empty.txt', prefix: '', size: 0 } ], {
			withEofMarker: true,
		} );

		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );

		expect( fs.statSync( path.join( extractDir, 'empty.txt' ) ).size ).toBe( 0 );
	} );
} );

describe( 'BackupHandlerWpress — damaged archives', () => {
	let tmpDir: string;
	let extractDir: string;
	let archivePath: string;
	let handler: BackupHandlerWpress;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wpress-damaged-test-' ) );
		extractDir = path.join( tmpDir, 'extract' );
		archivePath = path.join( tmpDir, 'damaged.wpress' );
		fs.mkdirSync( extractDir );
		handler = new BackupHandlerWpress();
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'rejects an archive cut in the middle of an entry instead of hanging', async () => {
		const content = pseudoRandomBytes( 10 * 1024 );
		writeSparseWpress( archivePath, [
			{ name: 'cut.bin', prefix: '', size: content.length, content },
		] );
		// Drop the last 4 KiB of the entry.
		fs.truncateSync( archivePath, HEADER_SIZE + content.length - 4096 );

		await expect(
			handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir )
		).rejects.toMatchObject( { message: expect.stringContaining( 'truncated' ) } );
	}, 10_000 );

	it( 'rejects an archive cut in the middle of a header', async () => {
		writeSparseWpress( archivePath, [
			{ name: 'ok.txt', prefix: '', size: 3, content: Buffer.from( 'abc' ) },
			{ name: 'next.txt', prefix: '', size: 3, content: Buffer.from( 'def' ) },
		] );
		// Keep the first entry whole and half of the second header.
		fs.truncateSync( archivePath, HEADER_SIZE + 3 + Math.floor( HEADER_SIZE / 2 ) );

		await expect(
			handler.listFiles( { path: archivePath, type: 'wpress' } )
		).rejects.toMatchObject( { message: expect.stringContaining( 'truncated' ) } );
	} );

	it( 'accepts an archive whose EOF marker is cut short, since every entry is complete', async () => {
		writeSparseWpress(
			archivePath,
			[ { name: 'whole.txt', prefix: '', size: 5, content: Buffer.from( 'whole' ) } ],
			{ withEofMarker: true }
		);
		// Keep the entry and only a third of the trailing EOF marker.
		fs.truncateSync( archivePath, HEADER_SIZE + 5 + Math.floor( HEADER_SIZE / 3 ) );

		await expect( handler.listFiles( { path: archivePath, type: 'wpress' } ) ).resolves.toEqual( [
			'whole.txt',
		] );
		await handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir );
		expect( fs.readFileSync( path.join( extractDir, 'whole.txt' ), 'utf8' ) ).toBe( 'whole' );
	} );

	it( 'rejects a header whose size field is not a number', async () => {
		const header = Buffer.alloc( HEADER_SIZE );
		header.write( 'weird.txt', 0, 'utf8' );
		header.write( 'not-a-size', 255, 'utf8' );
		fs.writeFileSync( archivePath, Buffer.concat( [ header, Buffer.alloc( HEADER_SIZE ) ] ) );

		await expect(
			handler.listFiles( { path: archivePath, type: 'wpress' } )
		).rejects.toMatchObject( { message: expect.stringContaining( 'invalid size' ) } );
	} );

	it( 'surfaces write failures instead of silently skipping the entry', async () => {
		// The first entry creates a directory named "clash"; the second wants to
		// write a file at that same path, which fails with EISDIR.
		writeSparseWpress(
			archivePath,
			[
				{ name: 'inner.txt', prefix: 'clash', size: 2, content: Buffer.from( 'hi' ) },
				{ name: 'clash', prefix: '', size: 2, content: Buffer.from( 'no' ) },
			],
			{ withEofMarker: true }
		);

		await expect(
			handler.extractFiles( { path: archivePath, type: 'wpress' }, extractDir )
		).rejects.toMatchObject( { message: expect.stringContaining( 'Failed to extract "clash"' ) } );
	} );
} );
