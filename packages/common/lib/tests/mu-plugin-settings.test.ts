import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSiteFrontendAdminBar, updateSiteMetadata } from '../../sites/metadata';
import { getConfigPath, readConfig } from '../config/store';
import { syncMuPluginSettings } from '../mu-plugin-settings';
import { readUserPreferences, writeUserPreferences } from '../user-settings/user-preferences';
import { getMuPluginSettingsPath } from '../well-known-paths';

let configDir: string;
const preferencesContext = () => ( { sitesRoot: configDir } );
const runtimeSettings = async () =>
	JSON.parse( await readFile( getMuPluginSettingsPath(), 'utf8' ) );
const readSite = async ( id: string ) =>
	( await readConfig() ).sites.find( ( site ) => site.id === id );
const site = ( id: string, fields: object ) => ( {
	id,
	name: id,
	path: configDir,
	port: 8881,
	phpVersion: '8.3',
	...fields,
} );
const writeConfig = ( config: object ) =>
	writeFile( getConfigPath(), JSON.stringify( { version: 1, ...config } ) );

beforeEach( async () => {
	configDir = await mkdtemp( path.join( os.tmpdir(), 'studio-browser-settings-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	await writeConfig( {
		preferences: { hideFrontendAdminBar: false, privateState: 'not-for-php' },
		sites: [
			site( 'a', { sortOrder: 2, autoStart: true, futureField: 'kept' } ),
			site( 'b', { hideFrontendAdminBar: false } ),
		],
	} );
} );

afterEach( async () => {
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
		expect( await readSite( 'a' ) ).toMatchObject( {
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
		expect( await readSite( 'a' ) ).toMatchObject( {
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
		expect( ( await readSite( 'a' ) )?.hideFrontendAdminBar ).toBeUndefined();
	} );

	it( 'recreates runtime settings from saved preferences and ignores malformed values', async () => {
		await writeConfig( {
			preferences: { hideFrontendAdminBar: 'true' },
			sites: [
				site( 'bad', { hideFrontendAdminBar: 'hide' } ),
				site( 'good', { hideFrontendAdminBar: true } ),
			],
		} );
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
