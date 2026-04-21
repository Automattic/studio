import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renameProcessManagerHome } from '../03-rename-pm-home';

describe( 'renameProcessManagerHome migration', () => {
	let tmpHome: string;

	beforeEach( () => {
		tmpHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pm-home-migration-' ) );
		vi.spyOn( os, 'homedir' ).mockReturnValue( tmpHome );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		fs.rmSync( tmpHome, { recursive: true, force: true } );
	} );

	function legacyPath() {
		return path.join( tmpHome, '.studio', 'pm2' );
	}

	function newPath() {
		return path.join( tmpHome, '.studio', 'daemon' );
	}

	it( 'does not run when neither legacy nor new path exists', async () => {
		expect( await renameProcessManagerHome.needsToRun() ).toBe( false );
	} );

	it( 'does not run when only the new path exists', async () => {
		fs.mkdirSync( newPath(), { recursive: true } );
		expect( await renameProcessManagerHome.needsToRun() ).toBe( false );
	} );

	it( 'does not run when both legacy and new paths exist', async () => {
		fs.mkdirSync( legacyPath(), { recursive: true } );
		fs.mkdirSync( newPath(), { recursive: true } );
		expect( await renameProcessManagerHome.needsToRun() ).toBe( false );
	} );

	it( 'runs when legacy path exists and new path does not', async () => {
		fs.mkdirSync( legacyPath(), { recursive: true } );
		expect( await renameProcessManagerHome.needsToRun() ).toBe( true );
	} );

	it( 'renames the legacy folder to the new path and preserves contents', async () => {
		fs.mkdirSync( path.join( legacyPath(), 'logs' ), { recursive: true } );
		fs.writeFileSync( path.join( legacyPath(), 'logs', 'site-1-out.log' ), 'hello' );
		fs.writeFileSync( path.join( legacyPath(), 'pm2.log' ), 'legacy pm2 artifact' );
		fs.writeFileSync( path.join( legacyPath(), 'pm-connection.lock' ), '' );

		await renameProcessManagerHome.run();

		expect( fs.existsSync( legacyPath() ) ).toBe( false );
		expect( fs.existsSync( newPath() ) ).toBe( true );
		expect( fs.readFileSync( path.join( newPath(), 'logs', 'site-1-out.log' ), 'utf-8' ) ).toBe(
			'hello'
		);
		expect( fs.readFileSync( path.join( newPath(), 'pm2.log' ), 'utf-8' ) ).toBe(
			'legacy pm2 artifact'
		);
		expect( fs.existsSync( path.join( newPath(), 'pm-connection.lock' ) ) ).toBe( true );
	} );
} );
