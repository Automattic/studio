import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CONFIG_VERSION } from '@studio/common/lib/config/schema';
import {
	ConfigTooNewError,
	getConfigPath,
	readConfig,
	updateConfig,
} from '@studio/common/lib/config/store';

let configDir: string;

const site = { id: 'site-1', name: 'Site', path: '/sites/one', port: 8881, phpVersion: '8.3' };

function writeConfig( config: Record< string, unknown > ) {
	writeFileSync( getConfigPath(), JSON.stringify( { version: CONFIG_VERSION, ...config } ) );
}

function readFile() {
	return JSON.parse( readFileSync( getConfigPath(), 'utf8' ) );
}

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-config-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'creates an empty config on a fresh install', async () => {
	const config = await readConfig();

	expect( config.sites ).toEqual( [] );
	expect( config.providers.configs ).toEqual( {} );
	expect( readFile() ).toMatchObject( { version: CONFIG_VERSION } );
} );

it( 'writes back only the sections an update changed', async () => {
	writeConfig( { sites: [ site ], preferences: { colorScheme: 42 }, future: { kept: true } } );

	await updateConfig( ( { sites } ) => {
		sites[ 0 ].name = 'Renamed';
	} );

	expect( readFile() ).toEqual( {
		version: CONFIG_VERSION,
		sites: [ { ...site, name: 'Renamed', status: 'ready' } ],
		preferences: { colorScheme: 42 },
		future: { kept: true },
	} );
} );

it( 'reads a broken section as empty without losing the others', async () => {
	writeConfig( { sites: [ site ], sessions: 'broken' } );

	const config = await readConfig();
	await updateConfig( ( { preferences } ) => {
		preferences.locale = 'fr';
	} );

	expect( config.sessions ).toEqual( {} );
	expect( config.sites ).toHaveLength( 1 );
	expect( readFile().sessions ).toBe( 'broken' );
} );

it( 'hides the entries of a list that do not parse, and keeps them on disk', async () => {
	writeConfig( { sites: [ site, { id: 'no-path' } ] } );

	expect( ( await readConfig() ).sites.map( ( { id } ) => id ) ).toEqual( [ 'site-1' ] );
	await updateConfig( ( { sites } ) => {
		sites[ 0 ].name = 'Renamed';
	} );

	expect( readFile().sites ).toEqual( [
		{ ...site, name: 'Renamed', status: 'ready' },
		{ id: 'no-path' },
	] );
} );

it( 'refuses a config file from a newer build', async () => {
	writeFileSync( getConfigPath(), JSON.stringify( { version: CONFIG_VERSION + 1 } ) );

	await expect( readConfig() ).rejects.toBeInstanceOf( ConfigTooNewError );
	await expect( updateConfig( () => undefined ) ).rejects.toBeInstanceOf( ConfigTooNewError );
} );

it( 'moves an unreadable config file aside', async () => {
	writeFileSync( getConfigPath(), '{ not json' );

	await readConfig();

	expect(
		readdirSync( configDir ).some( ( name ) => name.startsWith( 'config.json.invalid-' ) )
	).toBe( true );
	expect( readFile() ).toMatchObject( { version: CONFIG_VERSION } );
} );

it( 'serializes concurrent updates so none is lost', async () => {
	writeConfig( { sites: [ site ] } );

	await Promise.all(
		Array.from( { length: 10 }, ( _, index ) =>
			updateConfig( ( { sessions } ) => {
				sessions[ `session-${ index }` ] = { title: `Chat ${ index }` };
			} )
		)
	);

	expect( Object.keys( readFile().sessions ) ).toHaveLength( 10 );
} );

it( 'rejects an update made inside another', async () => {
	await expect( updateConfig( () => updateConfig( () => undefined ) ) ).rejects.toThrow(
		'inside another updateConfig'
	);
} );
