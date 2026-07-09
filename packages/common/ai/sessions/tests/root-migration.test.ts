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

	function isLinkTo( linkPath: string, target: string ): boolean {
		return (
			fs.lstatSync( linkPath ).isSymbolicLink() &&
			fs.realpathSync( linkPath ) === fs.realpathSync( target )
		);
	}

	it( 'moves the legacy directory to the new root and links the old location', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( legacy, '2026/07/08/session.jsonl', 'original\n' );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'session.jsonl' ), 'utf8' )
		).toBe( 'original\n' );
		expect( isLinkTo( legacy, newRoot ) ).toBe( true );
		// Old binaries and persisted absolute paths keep working via the link.
		expect(
			fs.readFileSync( path.join( legacy, '2026', '07', '08', 'session.jsonl' ), 'utf8' )
		).toBe( 'original\n' );
		seed( legacy, '2026/07/09/via-link.jsonl', 'written through link\n' );
		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '09', 'via-link.jsonl' ), 'utf8' )
		).toBe( 'written through link\n' );
	} );

	it( 'is a no-op when the legacy location is already a link', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( legacy, '2026/07/08/session.jsonl', 'original\n' );
		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( isLinkTo( legacy, newRoot ) ).toBe( true );
		expect( fs.existsSync( path.join( newRoot, 'sessions' ) ) ).toBe( false );
		expect( fs.readdirSync( path.join( newRoot, '2026', '07', '08' ) ) ).toEqual( [
			'session.jsonl',
		] );
	} );

	it( 'merges stragglers into an existing new root, then links', () => {
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
		expect( isLinkTo( legacy, newRoot ) ).toBe( true );
	} );

	it( 'keeps the destination file on collision and does not link the leftover', () => {
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
		expect( fs.lstatSync( legacy ).isSymbolicLink() ).toBe( false );
	} );

	it( 'repairs a missing link when the new root and the legacy parent exist', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		fs.mkdirSync( path.dirname( legacy ), { recursive: true } );
		seed( newRoot, '2026/07/08/session.jsonl', 'already migrated\n' );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( isLinkTo( legacy, newRoot ) ).toBe( true );
	} );

	it( 'does nothing when neither the legacy parent nor the new root exist', () => {
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );

		migrateLegacyAiSessionsRoot( newRoot, [ path.join( tmpDir, 'missing', 'sessions' ) ] );

		expect( fs.existsSync( newRoot ) ).toBe( false );
		expect( fs.existsSync( path.join( tmpDir, 'missing' ) ) ).toBe( false );
	} );
} );
