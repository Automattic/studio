import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import trash from 'trash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCliInstallKind } from 'cli/lib/update-notifier';
import { runCommand } from '../uninstall';

vi.mock( 'trash' );

vi.mock( 'cli/lib/update-notifier', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/update-notifier') >() ),
	getCliInstallKind: vi.fn(),
} ) );

vi.mock( 'cli/commands/site/stop', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('../site/stop') >() ),
	runCommand: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'CLI: studio uninstall', () => {
	let root: string;
	let installDir: string;
	let configDir: string;
	const originalExecPath = process.execPath;
	const originalPlatform = process.platform;

	const setPlatform = ( value: NodeJS.Platform ) =>
		Object.defineProperty( process, 'platform', { value, configurable: true } );

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-uninstall-' ) );
		installDir = path.join( root, '.studio' );
		configDir = path.join( root, 'config' );

		fs.mkdirSync( path.join( installDir, 'bin' ), { recursive: true } );
		fs.mkdirSync( path.join( installDir, 'cli' ), { recursive: true } );
		fs.writeFileSync( path.join( installDir, 'bin', 'node' ), '' );
		fs.mkdirSync( configDir, { recursive: true } );
		fs.writeFileSync( path.join( configDir, 'cli.json' ), '{}' );

		// The launcher runs `<installDir>/bin/node`, so this is how the command
		// locates the bundle to remove.
		Object.defineProperty( process, 'execPath', {
			value: path.join( installDir, 'bin', 'node' ),
			configurable: true,
		} );
		process.env.DEV_CONFIG_DIR = configDir;
		// Pin to a POSIX platform so the in-process removal path is exercised
		// deterministically (on Windows the runner defers deletion to a helper).
		setPlatform( 'linux' );
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.mocked( getCliInstallKind ).mockReturnValue( 'standalone' );
	} );

	afterEach( () => {
		Object.defineProperty( process, 'execPath', {
			value: originalExecPath,
			configurable: true,
		} );
		setPlatform( originalPlatform );
		delete process.env.DEV_CONFIG_DIR;
		process.exitCode = 0;
		fs.rmSync( root, { recursive: true, force: true } );
		vi.restoreAllMocks();
	} );

	it( 'removes the bundle dirs but keeps user config by default', async () => {
		await runCommand( false );

		expect( fs.existsSync( path.join( installDir, 'bin' ) ) ).toBe( false );
		expect( fs.existsSync( path.join( installDir, 'cli' ) ) ).toBe( false );
		expect( fs.existsSync( configDir ) ).toBe( true );
	} );

	it( 'trashes user config when --purge is passed non-interactively', async () => {
		Object.defineProperty( process.stdin, 'isTTY', { value: false, configurable: true } );

		await runCommand( true );

		expect( fs.existsSync( path.join( installDir, 'cli' ) ) ).toBe( false );
		expect( trash ).toHaveBeenCalledWith( configDir );
	} );

	it( 'does nothing destructive for non-standalone installs', async () => {
		vi.mocked( getCliInstallKind ).mockReturnValue( 'npm' );

		await runCommand( true );

		expect( fs.existsSync( path.join( installDir, 'bin' ) ) ).toBe( true );
		expect( trash ).not.toHaveBeenCalled();
		expect( process.exitCode ).toBe( 1 );
	} );
} );
