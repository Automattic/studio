import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	migrateLegacyAiSessionsRoot,
	resolveMigratedAiSessionsPath,
	withSessionsMigrationLock,
} from '@studio/common/ai/sessions/root-migration';

describe( 'migrateLegacyAiSessionsRoot', () => {
	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-sessions-' ) );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
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

	it( 'moves the legacy directory to the new root and links the old location', async () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( legacy, '2026/07/08/session.jsonl', 'original\n' );

		await migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

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

	it( 'is a no-op when the legacy location is already a link', async () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( legacy, '2026/07/08/session.jsonl', 'original\n' );
		await migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		await migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( isLinkTo( legacy, newRoot ) ).toBe( true );
		expect( fs.existsSync( path.join( newRoot, 'sessions' ) ) ).toBe( false );
		expect( fs.readdirSync( path.join( newRoot, '2026', '07', '08' ) ) ).toEqual( [
			'session.jsonl',
		] );
	} );

	it( 'moves a custom legacy link without moving its target', async () => {
		const customRoot = path.join( tmpDir, 'custom-sessions' );
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( customRoot, '2026/07/08/session.jsonl', 'custom\n' );
		fs.mkdirSync( path.dirname( legacy ), { recursive: true } );
		fs.symlinkSync( customRoot, legacy, 'junction' );

		await migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( fs.lstatSync( newRoot ).isSymbolicLink() ).toBe( true );
		expect( fs.realpathSync( newRoot ) ).toBe( fs.realpathSync( customRoot ) );
		expect( isLinkTo( legacy, newRoot ) ).toBe( true );
		expect(
			fs.readFileSync( path.join( customRoot, '2026', '07', '08', 'session.jsonl' ), 'utf8' )
		).toBe( 'custom\n' );
	} );

	it( 'merges stragglers into an existing new root, then links', async () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( newRoot, '2026/07/08/existing.jsonl', 'existing\n' );
		seed( legacy, '2026/07/09/straggler.jsonl', 'straggler\n' );

		await migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '08', 'existing.jsonl' ), 'utf8' )
		).toBe( 'existing\n' );
		expect(
			fs.readFileSync( path.join( newRoot, '2026', '07', '09', 'straggler.jsonl' ), 'utf8' )
		).toBe( 'straggler\n' );
		expect( isLinkTo( legacy, newRoot ) ).toBe( true );
	} );

	it( 'keeps the destination file on collision and does not link the leftover', async () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		seed( newRoot, '2026/07/08/session.jsonl', 'migrated\n' );
		seed( legacy, '2026/07/08/session.jsonl', 'stale copy\n' );
		seed( legacy, '2026/07/08/other.jsonl', 'other\n' );

		await migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

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

	it( 'keeps link failures retryable and maps migrated artifact paths', async () => {
		const legacy = path.join( tmpDir, 'legacy', 'sessions' );
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );
		const artifact = '2026/07/08/session.screenshots/screenshot.jpg';
		const legacyArtifact = path.join( legacy, artifact );
		seed( legacy, artifact, 'image' );
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		vi.spyOn( fs.promises, 'symlink' ).mockRejectedValueOnce(
			Object.assign( new Error( 'link unavailable' ), { code: 'EPERM' } )
		);

		await migrateLegacyAiSessionsRoot( newRoot, [ legacy ] );

		expect( fs.lstatSync( legacy ).isDirectory() ).toBe( true );
		expect( fs.existsSync( legacyArtifact ) ).toBe( false );
		const resolved = resolveMigratedAiSessionsPath( legacyArtifact, newRoot, [ legacy ] );
		expect( fs.readFileSync( resolved, 'utf8' ) ).toBe( 'image' );
	} );

	it( 'keeps the migration lock fresh while async work is running', async () => {
		const lockPath = path.join( tmpDir, 'migration.lock' );
		const events: string[] = [];
		let markStarted: () => void = () => {};
		const started = new Promise< void >( ( resolve ) => {
			markStarted = resolve;
		} );
		const options = { stale: 80, update: 20, wait: 1000 };
		const first = withSessionsMigrationLock(
			lockPath,
			async () => {
				markStarted();
				await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
				events.push( 'first-finished' );
			},
			options
		);
		await started;
		const second = withSessionsMigrationLock(
			lockPath,
			async () => {
				events.push( 'second-started' );
			},
			options
		);

		await Promise.all( [ first, second ] );

		expect( events ).toEqual( [ 'first-finished', 'second-started' ] );
	} );

	it( 'does nothing when the legacy location does not exist', async () => {
		const newRoot = path.join( tmpDir, '.studio', 'sessions' );

		await migrateLegacyAiSessionsRoot( newRoot, [ path.join( tmpDir, 'missing', 'sessions' ) ] );

		expect( fs.existsSync( newRoot ) ).toBe( false );
		expect( fs.existsSync( path.join( tmpDir, 'missing' ) ) ).toBe( false );
	} );
} );
