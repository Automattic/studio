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

	function seedLegacy( root: string ) {
		const dayDir = path.join( root, '2026', '07', '08' );
		fs.mkdirSync( dayDir, { recursive: true } );
		fs.writeFileSync( path.join( dayDir, 'session.jsonl' ), '{"type":"session"}\n' );
	}

	it( 'moves the legacy sessions directory to the new root', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seedLegacy( legacy );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( fs.existsSync( legacy ) ).toBe( false );
		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'session.jsonl' ), 'utf8' )
		).toBe( '{"type":"session"}\n' );
	} );

	it( 'uses the first existing legacy candidate', () => {
		const missing = path.join( tmpDir, 'missing', 'sessions' );
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seedLegacy( legacy );

		migrateLegacyAiSessionsRoot( newRoot, [ missing, legacy ] );

		expect( fs.existsSync( path.join( newRoot, '2026', '07', '08', 'session.jsonl' ) ) ).toBe(
			true
		);
	} );

	it( 'does nothing when the new root already exists', () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seedLegacy( legacy );
		fs.mkdirSync( newRoot, { recursive: true } );

		migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( fs.existsSync( path.join( legacy, '2026', '07', '08', 'session.jsonl' ) ) ).toBe(
			true
		);
		expect( fs.existsSync( path.join( newRoot, '2026' ) ) ).toBe( false );
	} );

	it( 'does nothing when no legacy directory exists', () => {
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );

		migrateLegacyAiSessionsRoot( newRoot, [ path.join( tmpDir, 'missing' ) ] );

		expect( fs.existsSync( newRoot ) ).toBe( false );
	} );
} );
