import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyAiSessionsRoot } from '@studio/common/ai/sessions/root-migration';

describe( 'migrateLegacyAiSessionsRoot', () => {
	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-sessions-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	function seed( root: string, relativePath: string, content: string ) {
		const filePath = path.join( root, relativePath );
		fs.mkdirSync( path.dirname( filePath ), { recursive: true } );
		fs.writeFileSync( filePath, content );
	}

	it( 'moves the legacy sessions directory to the new root', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( legacy, '2026/07/08/session.jsonl', '{"type":"session"}\n' );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( fs.existsSync( legacy ) ).toBe( false );
		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'session.jsonl' ), 'utf8' )
		).toBe( '{"type":"session"}\n' );
	} );

	it( 'merges every existing legacy candidate', () => {
		const legacyA = path.join( tmpDir, 'legacy-a', 'sessions' );
		const legacyB = path.join( tmpDir, 'legacy-b', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( legacyA, '2026/07/08/a.jsonl', 'a\n' );
		seed( legacyB, '2026/07/09/b.jsonl', 'b\n' );

		migrateLegacyAiSessionsRoot( newRoot, [ legacyA, legacyB ] );

		expect( fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'a.jsonl' ), 'utf8' ) ).toBe(
			'a\n'
		);
		expect( fs.readFileSync( path.join( newRoot, '2026', '07', '09', 'b.jsonl' ), 'utf8' ) ).toBe(
			'b\n'
		);
		expect( fs.existsSync( legacyA ) ).toBe( false );
		expect( fs.existsSync( legacyB ) ).toBe( false );
	} );

	it( 'sweeps stragglers into an existing new root', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( newRoot, '2026/07/08/existing.jsonl', 'existing\n' );
		seed( legacy, '2026/07/09/straggler.jsonl', 'straggler\n' );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'existing.jsonl' ), 'utf8' )
		).toBe( 'existing\n' );
		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '09', 'straggler.jsonl' ), 'utf8' )
		).toBe( 'straggler\n' );
		expect( fs.existsSync( legacy ) ).toBe( false );
	} );

	it( 'keeps the destination file and leaves the source behind on collision', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( newRoot, '2026/07/08/session.jsonl', 'migrated\n' );
		seed( legacy, '2026/07/08/session.jsonl', 'stale copy\n' );
		seed( legacy, '2026/07/08/other.jsonl', 'other\n' );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'session.jsonl' ), 'utf8' )
		).toBe( 'migrated\n' );
		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'other.jsonl' ), 'utf8' )
		).toBe( 'other\n' );
		expect(
			fs.readFileSync( path.join( legacy, '2026', '07', '08', 'session.jsonl' ), 'utf8' )
		).toBe( 'stale copy\n' );
	} );

	it( 'does nothing when no legacy directory exists', () => {
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );

		migrateLegacyAiSessionsRoot( newRoot, [ path.join( tmpDir, 'missing' ) ] );

		expect( fs.existsSync( newRoot ) ).toBe( false );
	} );
} );
