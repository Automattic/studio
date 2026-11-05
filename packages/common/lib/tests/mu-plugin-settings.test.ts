import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	readSiteMetadata,
	setSiteFrontendAdminBar,
	updateSiteMetadata,
} from '../../sites/metadata';
import * as appConfig from '../app-config';
import { syncMuPluginSettings } from '../mu-plugin-settings';
import { readUserPreferences, writeUserPreferences } from '../user-settings/user-preferences';
import { getMuPluginSettingsPath } from '../well-known-paths';

let configDir: string;
const preferencesContext = () => ( { sitesRoot: configDir } );
const runtimeSettings = async () =>
	JSON.parse( await readFile( getMuPluginSettingsPath(), 'utf8' ) );

beforeEach( async () => {
	configDir = await mkdtemp( path.join( os.tmpdir(), 'studio-browser-settings-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	await writeFile(
		path.join( configDir, 'app.json' ),
		JSON.stringify( {
			hideFrontendAdminBar: false,
			privateState: 'not-for-php',
			siteMetadata: {
				a: { sortOrder: 2, autoStart: true, futureField: 'kept' },
				b: { hideFrontendAdminBar: false },
			},
		} )
	);
	await writeFile(
		path.join( configDir, 'cli.json' ),
		JSON.stringify( { sites: [ { id: 'a', name: 'A', path: configDir } ] } )
	);
} );

afterEach( async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm( configDir, { recursive: true, force: true } );
} );

describe( 'MU plugin browser settings', () => {
	it( 'publishes only the global default and explicit site overrides', async () => {
		await syncMuPluginSettings();
		expect( await runtimeSettings() ).toEqual( {
			hideFrontendAdminBar: false,
			sites: { b: false },
		} );
		await writeUserPreferences( { hideFrontendAdminBar: true }, preferencesContext() );
		await setSiteFrontendAdminBar( 'a', false );
		expect( await runtimeSettings() ).toEqual( {
			hideFrontendAdminBar: true,
			sites: { a: false, b: false },
		} );
		await setSiteFrontendAdminBar( 'a', true );
		expect( ( await runtimeSettings() ).sites.a ).toBe( true );
	} );

	it( 'clears only the override and lets sites inherit subsequent default changes', async () => {
		await setSiteFrontendAdminBar( 'a', true );
		await setSiteFrontendAdminBar( 'a', null );
		expect( ( await readSiteMetadata() ).a ).toMatchObject( {
			sortOrder: 2,
			autoStart: true,
			futureField: 'kept',
		} );
		expect( ( await runtimeSettings() ).sites ).not.toHaveProperty( 'a' );
		await writeUserPreferences( { hideFrontendAdminBar: true }, preferencesContext() );
		expect( ( await runtimeSettings() ).hideFrontendAdminBar ).toBe( true );
		await writeUserPreferences( { hideFrontendAdminBar: null }, preferencesContext() );
		expect( ( await readUserPreferences( preferencesContext() ) ).hideFrontendAdminBar ).toBe(
			false
		);
		expect( ( await runtimeSettings() ).hideFrontendAdminBar ).toBe( false );
	} );

	it( 'serializes global, override, and unrelated metadata writes without losing state', async () => {
		await Promise.all( [
			writeUserPreferences( { hideFrontendAdminBar: true }, preferencesContext() ),
			setSiteFrontendAdminBar( 'a', false ),
			updateSiteMetadata( { a: { sortOrder: 7 } } ),
		] );
		expect( ( await readSiteMetadata() ).a ).toMatchObject( {
			sortOrder: 7,
			autoStart: true,
			hideFrontendAdminBar: false,
		} );
		expect( await runtimeSettings() ).toEqual( {
			hideFrontendAdminBar: true,
			sites: { a: false, b: false },
		} );
	} );

	it( 'rejects invalid overrides and unknown sites without changing settings', async () => {
		await expect( setSiteFrontendAdminBar( 'missing', true ) ).rejects.toThrow( 'Site not found' );
		await expect( setSiteFrontendAdminBar( 'a', 'hide' as unknown as boolean ) ).rejects.toThrow();
		expect( ( await readSiteMetadata() ).a.hideFrontendAdminBar ).toBeUndefined();
	} );

	it( 'leaves the saved preference unchanged if publishing the runtime settings fails', async () => {
		await mkdir( getMuPluginSettingsPath(), { recursive: true } );
		await expect(
			writeUserPreferences( { hideFrontendAdminBar: true }, preferencesContext() )
		).rejects.toThrow();
		expect( ( await readUserPreferences( preferencesContext() ) ).hideFrontendAdminBar ).toBe(
			false
		);
		await rm( getMuPluginSettingsPath(), { recursive: true } );
		await writeUserPreferences( { hideFrontendAdminBar: true }, preferencesContext() );
		expect( ( await runtimeSettings() ).hideFrontendAdminBar ).toBe( true );
	} );

	it( 'restores the runtime settings if saving app.json fails', async () => {
		await syncMuPluginSettings();
		vi.spyOn( appConfig, 'saveAppConfig' ).mockRejectedValueOnce( new Error( 'write failed' ) );
		await expect(
			writeUserPreferences( { hideFrontendAdminBar: true }, preferencesContext() )
		).rejects.toThrow( 'write failed' );
		expect( ( await runtimeSettings() ).hideFrontendAdminBar ).toBe( false );
		expect( ( await readUserPreferences( preferencesContext() ) ).hideFrontendAdminBar ).toBe(
			false
		);
	} );

	it( 'recreates runtime settings from saved preferences and ignores malformed values', async () => {
		await writeFile(
			path.join( configDir, 'app.json' ),
			JSON.stringify( {
				hideFrontendAdminBar: 'true',
				siteMetadata: {
					bad: { hideFrontendAdminBar: 'hide' },
					good: { hideFrontendAdminBar: true },
				},
			} )
		);
		await syncMuPluginSettings();
		expect( await runtimeSettings() ).toEqual( {
			hideFrontendAdminBar: false,
			sites: { good: true },
		} );
		await rm( getMuPluginSettingsPath() );
		await syncMuPluginSettings();
		expect( ( await runtimeSettings() ).sites.good ).toBe( true );
	} );
} );
