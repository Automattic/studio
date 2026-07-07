import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAgentsInstructions } from 'cli/ai/runtimes/pi/agents-instructions';

const mocks = vi.hoisted( () => ( { globalPath: '' } ) );

vi.mock( '@studio/common/lib/well-known-paths', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/lib/well-known-paths') >();
	return {
		...actual,
		getGlobalAgentsFilePath: () => mocks.globalPath,
	};
} );

describe( 'loadAgentsInstructions', () => {
	let dir: string;
	let siteDir: string;

	beforeEach( () => {
		dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-agents-instructions-' ) );
		mocks.globalPath = path.join( dir, 'global-AGENTS.md' );
		siteDir = path.join( dir, 'site' );
		fs.mkdirSync( siteDir );
	} );

	afterEach( () => {
		fs.rmSync( dir, { recursive: true, force: true } );
		vi.restoreAllMocks();
	} );

	it( 'returns an empty array when neither file exists', async () => {
		expect( await loadAgentsInstructions( siteDir ) ).toEqual( [] );
	} );

	it( 'skips a blank global file', async () => {
		fs.writeFileSync( mocks.globalPath, '   \n\t\n' );
		expect( await loadAgentsInstructions() ).toEqual( [] );
	} );

	it( 'loads only the global file when no site path is given', async () => {
		fs.writeFileSync( mocks.globalPath, 'Prefer TypeScript.' );

		const result = await loadAgentsInstructions();

		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ] ).toContain( 'Prefer TypeScript.' );
		expect( result[ 0 ] ).toContain( mocks.globalPath );
		expect( result[ 0 ] ).toContain( 'takes precedence' );
	} );

	it( 'loads only the site file when the global file is absent', async () => {
		fs.writeFileSync( path.join( siteDir, 'AGENTS.md' ), 'This site uses WooCommerce.' );

		const result = await loadAgentsInstructions( siteDir );

		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ] ).toContain( 'This site uses WooCommerce.' );
		expect( result[ 0 ] ).toContain( path.join( siteDir, 'AGENTS.md' ) );
	} );

	it( 'loads global before site content when both exist', async () => {
		fs.writeFileSync( mocks.globalPath, 'GLOBAL PREF' );
		fs.writeFileSync( path.join( siteDir, 'AGENTS.md' ), 'SITE PREF' );

		const result = await loadAgentsInstructions( siteDir );

		expect( result ).toHaveLength( 2 );
		expect( result[ 0 ] ).toContain( 'GLOBAL PREF' );
		expect( result[ 1 ] ).toContain( 'SITE PREF' );
		expect( result[ 1 ] ).toContain( 'take precedence over the global instructions' );
	} );

	it( 'skips a non-ENOENT read error and still loads the other file', async () => {
		// A directory at the global path makes readFile fail with EISDIR (not ENOENT).
		fs.mkdirSync( mocks.globalPath );
		fs.writeFileSync( path.join( siteDir, 'AGENTS.md' ), 'SITE ONLY' );
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		const result = await loadAgentsInstructions( siteDir );

		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ] ).toContain( 'SITE ONLY' );
		expect( warn ).toHaveBeenCalledOnce();
	} );
} );
