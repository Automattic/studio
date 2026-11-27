import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CONFIG_VERSION } from '@studio/common/lib/config/schema';
import {
	ConfigTooNewError,
	getConfigPath,
	readConfig,
	readConfigSync,
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

it.skipIf( process.platform === 'win32' )(
	'keeps the config readable by the user alone',
	async () => {
		writeConfig( {} );

		await updateConfig( ( config ) => {
			config.sites.push( site );
		} );

		expect( statSync( getConfigPath() ).mode & 0o777 ).toBe( 0o600 );
	}
);

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

it( 'moves preview versions onto the matching local site, provider and account once', async () => {
	const preview = {
		atomicSiteId: 42,
		url: 'demo.wpcomstaging.com',
		date: 100,
		localSiteId: site.id,
		userId: 7,
	};
	const otherAccount = {
		provider: 'wpcom',
		account: '8',
		site: { id: 42 },
		localVersionId: 'other-account',
	};
	const otherProvider = {
		provider: 'spacefast',
		site: { id: 42 },
		localVersionId: 'other-provider',
	};
	const newerPartial = {
		provider: 'wpcom',
		account: '7',
		site: { id: 43 },
		localVersionId: null,
		lastPullTimestamp: new Date( 200 ).toISOString(),
	};
	const orphan = {
		...preview,
		localSiteId: 'missing',
		atomicSiteId: 44,
		versionId: 'orphan',
		syncedAt: 100,
	};
	writeConfig( {
		version: 1,
		future: 'preserved',
		sites: [
			{ ...site, futureSiteField: 1, connections: [ otherAccount, otherProvider, newerPartial ] },
		],
		snapshots: [
			{ ...preview, versionId: 'version', syncedAt: 100, futurePreviewField: 2 },
			{ ...preview, atomicSiteId: 43, versionId: 'stale', syncedAt: 100 },
			orphan,
		],
	} );
	await readConfig();
	const migrated = readFile();
	expect( migrated ).toMatchObject( {
		version: CONFIG_VERSION,
		future: 'preserved',
		sites: [ { futureSiteField: 1 } ],
	} );
	expect( migrated.sites[ 0 ].connections ).toEqual( [
		otherAccount,
		otherProvider,
		newerPartial,
		{
			provider: 'wpcom',
			account: '7',
			site: { id: 42 },
			preview: true,
			localVersionId: 'version',
			lastPushTimestamp: new Date( 100 ).toISOString(),
			lastPullTimestamp: null,
		},
	] );
	expect( migrated.snapshots ).toEqual( [
		{ ...preview, futurePreviewField: 2 },
		{ ...preview, atomicSiteId: 43 },
		orphan,
	] );
	await readConfig();
	expect( readFile() ).toEqual( migrated );
} );

it( 'reads startup settings from an older config before the first locked migration', async () => {
	writeConfig( {
		version: 1,
		cli: { tosNoticeShownAt: 123 },
		install: { sentryUserId: 'existing' },
	} );
	expect( readConfigSync() ).toMatchObject( {
		cli: { tosNoticeShownAt: 123 },
		install: { sentryUserId: 'existing' },
	} );
	expect( readFile().version ).toBe( 1 );
	await readConfig();
	expect( readFile().version ).toBe( CONFIG_VERSION );
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
