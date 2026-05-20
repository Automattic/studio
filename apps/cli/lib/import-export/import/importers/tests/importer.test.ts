import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureDir } from '../importer';

describe( 'ensureDir', () => {
	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ensure-dir-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'creates a directory that does not exist', async () => {
		const target = path.join( tmpDir, 'a', 'b', 'c' );
		await ensureDir( target, tmpDir );
		expect( fs.lstatSync( target ).isDirectory() ).toBe( true );
	} );

	it( 'is a no-op when the directory already exists', async () => {
		const target = path.join( tmpDir, 'existing' );
		fs.mkdirSync( target );
		await expect( ensureDir( target, tmpDir ) ).resolves.toBeUndefined();
		expect( fs.lstatSync( target ).isDirectory() ).toBe( true );
	} );

	it( 'replaces a non-directory file blocking the target path', async () => {
		const wpContent = path.join( tmpDir, 'wp-content' );
		const plugins = path.join( wpContent, 'plugins' );
		fs.mkdirSync( plugins, { recursive: true } );
		const blocker = path.join( plugins, 'akismet' );
		fs.writeFileSync( blocker, '/managed/akismet' );
		expect( fs.lstatSync( blocker ).isFile() ).toBe( true );

		await ensureDir( blocker, wpContent );

		expect( fs.lstatSync( blocker ).isDirectory() ).toBe( true );
	} );

	it( 'replaces a non-directory file blocking an ancestor of the target path', async () => {
		const wpContent = path.join( tmpDir, 'wp-content' );
		const plugins = path.join( wpContent, 'plugins' );
		fs.mkdirSync( plugins, { recursive: true } );
		const blocker = path.join( plugins, 'akismet' );
		fs.writeFileSync( blocker, '/managed/akismet' );

		const deeper = path.join( blocker, '_inc' );
		await ensureDir( deeper, wpContent );

		expect( fs.lstatSync( blocker ).isDirectory() ).toBe( true );
		expect( fs.lstatSync( deeper ).isDirectory() ).toBe( true );
	} );

	// Defense-in-depth: if a malformed archive entry resolves to a path outside
	// the destination tree (e.g. via `..` segments) and that resolved path is
	// blocked by a non-directory file, ensureDir must NOT unlink it. The
	// original mkdir error should propagate and the on-disk file must remain.
	it( 'refuses to unlink a blocker outside rootDir', async () => {
		const wpContent = path.join( tmpDir, 'wp-content' );
		fs.mkdirSync( wpContent, { recursive: true } );
		const outsideBlocker = path.join( tmpDir, 'outside-file' );
		fs.writeFileSync( outsideBlocker, 'do-not-delete' );

		await expect( ensureDir( outsideBlocker, wpContent ) ).rejects.toMatchObject( {
			code: 'EEXIST',
		} );
		expect( fs.lstatSync( outsideBlocker ).isFile() ).toBe( true );
		expect( fs.readFileSync( outsideBlocker, 'utf-8' ) ).toBe( 'do-not-delete' );
	} );
} );
