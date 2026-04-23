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
