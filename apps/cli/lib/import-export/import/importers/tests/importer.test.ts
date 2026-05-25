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
		await ensureDir( target );
		expect( fs.lstatSync( target ).isDirectory() ).toBe( true );
	} );

	it( 'is a no-op when the directory already exists', async () => {
		const target = path.join( tmpDir, 'existing' );
		fs.mkdirSync( target );
		await expect( ensureDir( target ) ).resolves.toBeUndefined();
		expect( fs.lstatSync( target ).isDirectory() ).toBe( true );
	} );

	it( 'replaces a non-directory file blocking the target path', async () => {
		const plugins = path.join( tmpDir, 'wp-content', 'plugins' );
		fs.mkdirSync( plugins, { recursive: true } );
		const blocker = path.join( plugins, 'akismet' );
		fs.writeFileSync( blocker, '/managed/akismet' );
		expect( fs.lstatSync( blocker ).isFile() ).toBe( true );

		await ensureDir( blocker );

		expect( fs.lstatSync( blocker ).isDirectory() ).toBe( true );
	} );

	it( 'replaces a non-directory file blocking an ancestor of the target path', async () => {
		const plugins = path.join( tmpDir, 'wp-content', 'plugins' );
		fs.mkdirSync( plugins, { recursive: true } );
		const blocker = path.join( plugins, 'akismet' );
		fs.writeFileSync( blocker, '/managed/akismet' );

		const deeper = path.join( blocker, '_inc' );
		await ensureDir( deeper );

		expect( fs.lstatSync( blocker ).isDirectory() ).toBe( true );
		expect( fs.lstatSync( deeper ).isDirectory() ).toBe( true );
	} );
} );
