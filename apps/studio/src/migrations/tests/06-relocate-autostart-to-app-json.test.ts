/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import { readFile } from 'atomically';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { relocateAutostartToAppJson } from 'src/migrations/06-relocate-autostart-to-app-json';
import { loadUserData, saveUserData } from 'src/storage/user-data';
import type { UserData } from 'src/storage/storage-types';

vi.mock( 'node:fs', () => ( { default: { existsSync: vi.fn( () => true ) } } ) );
vi.mock( 'atomically', () => ( { readFile: vi.fn() } ) );
vi.mock( '@studio/common/lib/well-known-paths', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/well-known-paths') >() ),
	getCliConfigPath: () => '/test/cli.json',
} ) );
vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	saveUserData: vi.fn().mockResolvedValue( undefined ),
	lockAppdata: vi.fn().mockResolvedValue( undefined ),
	unlockAppdata: vi.fn().mockResolvedValue( undefined ),
} ) );

function makeUserData( overrides: Record< string, unknown > = {} ): UserData {
	return { version: 1, siteMetadata: {}, ...overrides } as UserData;
}

function mockCliJson( sites: { id: string; autoStart?: boolean }[] ) {
	vi.mocked( readFile ).mockResolvedValue(
		Buffer.from( JSON.stringify( { version: 1, sites, snapshots: [] } ) )
	);
}

function savedUserData() {
	return vi.mocked( saveUserData ).mock.calls[ 0 ][ 0 ] as UserData & { stopSitesOnQuit?: boolean };
}

describe( 'migration 06: relocate autoStart to app.json', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		mockCliJson( [] );
	} );

	describe( 'needsToRun', () => {
		it( 'runs until the marker is set', async () => {
			vi.mocked( loadUserData ).mockResolvedValue( makeUserData() );
			expect( await relocateAutostartToAppJson.needsToRun() ).toBe( true );

			vi.mocked( loadUserData ).mockResolvedValue( makeUserData( { autoStartRelocated: true } ) );
			expect( await relocateAutostartToAppJson.needsToRun() ).toBe( false );
		} );
	} );

	describe( 'run', () => {
		it( 'seeds per-site autoStart from cli.json, preserving existing metadata', async () => {
			mockCliJson( [ { id: 'a', autoStart: true }, { id: 'b', autoStart: false }, { id: 'c' } ] );
			vi.mocked( loadUserData ).mockResolvedValue(
				makeUserData( { siteMetadata: { a: { sortOrder: 1 } } } )
			);

			await relocateAutostartToAppJson.run();

			const saved = savedUserData();
			expect( saved.siteMetadata.a ).toEqual( { sortOrder: 1, autoStart: true } );
			expect( saved.siteMetadata.b ).toEqual( { autoStart: false } );
			// A site without autoStart in cli.json is left untouched.
			expect( saved.siteMetadata.c ).toBeUndefined();
			expect( saved.autoStartRelocated ).toBe( true );
		} );

		it( 'maps the old stopSitesOnQuit=true to stop-and-auto-start and drops the legacy key', async () => {
			vi.mocked( loadUserData ).mockResolvedValue( makeUserData( { stopSitesOnQuit: true } ) );

			await relocateAutostartToAppJson.run();

			const saved = savedUserData();
			expect( saved.quitSitesBehavior ).toBe( 'stop-and-auto-start' );
			expect( saved.stopSitesOnQuit ).toBeUndefined();
		} );

		it( 'maps the old stopSitesOnQuit=false to leave-running', async () => {
			vi.mocked( loadUserData ).mockResolvedValue( makeUserData( { stopSitesOnQuit: false } ) );

			await relocateAutostartToAppJson.run();

			expect( savedUserData().quitSitesBehavior ).toBe( 'leave-running' );
		} );

		it( 'does not overwrite an existing quitSitesBehavior', async () => {
			vi.mocked( loadUserData ).mockResolvedValue(
				makeUserData( { stopSitesOnQuit: true, quitSitesBehavior: 'stop' } )
			);

			await relocateAutostartToAppJson.run();

			expect( savedUserData().quitSitesBehavior ).toBe( 'stop' );
		} );

		it( 'tolerates a missing cli.json and still sets the marker', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			vi.mocked( loadUserData ).mockResolvedValue( makeUserData() );

			await relocateAutostartToAppJson.run();

			expect( savedUserData().autoStartRelocated ).toBe( true );
			expect( readFile ).not.toHaveBeenCalled();
		} );
	} );
} );
