import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildConfigFromLegacy } from '@studio/common/lib/config/legacy-import';
import { getConfigPath, readConfig } from '@studio/common/lib/config/store';

let configDir: string;
let appDataDir: string;

const token = {
	accessToken: 'token',
	expiresIn: 1000,
	expirationTime: 4_102_444_800_000,
	id: 7,
	email: 'person@example.com',
	displayName: 'Person',
};

const cliSite = {
	id: 'site-1',
	name: 'Site',
	path: '/sites/one',
	port: 8881,
	phpVersion: '8.3',
	running: false,
};

function writeJson( file: string, data: unknown ) {
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, JSON.stringify( data ) );
}

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-legacy-' ) );
	appDataDir = mkdtempSync( path.join( os.tmpdir(), 'studio-appdata-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	process.env.E2E = '1';
	process.env.E2E_APP_DATA_PATH = appDataDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	delete process.env.E2E;
	delete process.env.E2E_APP_DATA_PATH;
	rmSync( configDir, { recursive: true, force: true } );
	rmSync( appDataDir, { recursive: true, force: true } );
} );

it( 'folds the split files into one, by entity', () => {
	const config = buildConfigFromLegacy( {
		shared: {
			version: 1,
			authToken: token,
			locale: 'fr',
			analyticsInstallId: 'install',
			aiProvider: 'anthropic',
			anthropicApiKey: 'key',
			sessions: { chat: { title: 'Chat' } },
			connectedWpcomSites: {
				7: [
					{ id: 1, localSiteId: 'site-1', name: 'Live', lastPullTimestamp: 'then' },
					{ id: 2, localSiteId: 'deleted-site', name: 'Orphan' },
				],
			},
			remoteSites: { 'site-1': [ { provider: 'spacefast', site: { id: 's' } } ] },
		},
		cli: {
			version: 1,
			sites: [ { ...cliSite, runtime: 'playground', phpVersion: '5.6' } ],
			snapshots: [ { url: 'preview', atomicSiteId: 3, localSiteId: 'site-1', date: 1 } ],
			lastBumpStats: { group: { metric: 5 } },
			siteRuntimeStats: { 'site-1': { bumpedAt: 1, stat: 'native' } },
			tosNoticeShownAt: 9,
		},
		app: {
			version: 1,
			colorScheme: 'dark',
			stopSitesOnQuit: true,
			windowBounds: { x: 0, y: 0, width: 1, height: 1 },
			sentryUserId: 'sentry',
			siteMetadata: { 'site-1': { sortOrder: 2, autoStart: true }, gone: { sortOrder: 1 } },
			aiSessionPlacements: {
				chat: { kind: 'site', siteId: 'site-1', sitePath: '/sites/one', siteName: 'Site' },
			},
			lastBumpStats: {
				group: { metric: 8 },
				'local-environment-launch-uniques': { darwin: 1 },
			},
			betaFeatures: { enableAgenticUi: false },
			desks: [],
		},
	} );

	expect( config ).toEqual( {
		version: 2,
		install: { analyticsId: 'install', sentryUserId: 'sentry' },
		providers: {
			selected: 'anthropic',
			configs: {
				wpcom: {
					token: 'token',
					expiresAt: token.expirationTime,
					user: { id: 7, email: token.email, displayName: 'Person' },
				},
				anthropic: { method: 'api-key', apiKey: 'key' },
			},
		},
		preferences: {
			colorScheme: 'dark',
			locale: 'fr',
			quitSitesBehavior: 'stop-and-auto-start',
			onboardingHints: { migratedFromClassic: true },
		},
		sites: [
			{
				id: 'site-1',
				name: 'Site',
				path: '/sites/one',
				port: 8881,
				phpVersion: expect.not.stringMatching( /^5\.6$/ ),
				sortOrder: 2,
				autoStart: true,
				runtimeStat: { bumpedAt: 1, stat: 'native' },
				connections: [
					{
						provider: 'wpcom',
						account: '7',
						site: { id: 1, name: 'Live' },
						lastPushTimestamp: null,
						lastPullTimestamp: 'then',
					},
					{ provider: 'spacefast', site: { id: 's' } },
				],
			},
		],
		snapshots: [ { url: 'preview', atomicSiteId: 3, localSiteId: 'site-1', date: 1 } ],
		sessions: {
			chat: {
				title: 'Chat',
				placement: { kind: 'site', siteId: 'site-1', sitePath: '/sites/one', siteName: 'Site' },
			},
		},
		stats: { lastBump: { group: { metric: 8 }, 'studio-app-launch-uniques': { darwin: 1 } } },
		desktop: { windowBounds: { x: 0, y: 0, width: 1, height: 1 } },
		cli: { tosNoticeShownAt: 9 },
	} );
} );

it( 'imports the legacy files, keeping a backup it imports again if config.json is lost', async () => {
	writeJson( path.join( configDir, 'cli.json' ), { version: 1, sites: [ cliSite ] } );
	writeJson( path.join( configDir, 'app.json' ), { version: 1, colorScheme: 'dark' } );

	expect( ( await readConfig() ).sites.map( ( { id } ) => id ) ).toEqual( [ 'site-1' ] );

	const stub = { version: 2, movedTo: 'config.json' };
	expect( JSON.parse( readFileSync( path.join( configDir, 'cli.json' ), 'utf8' ) ) ).toEqual(
		stub
	);
	expect(
		JSON.parse( readFileSync( path.join( configDir, 'legacy-config', 'cli.json' ), 'utf8' ) )
	).toMatchObject( { sites: [ { id: 'site-1' } ] } );
	expect( existsSync( path.join( configDir, 'shared.json' ) ) ).toBe( false );

	rmSync( getConfigPath() );
	expect( ( await readConfig() ).sites.map( ( { id } ) => id ) ).toEqual( [ 'site-1' ] );
	expect(
		JSON.parse( readFileSync( path.join( configDir, 'legacy-config', 'cli.json' ), 'utf8' ) )
	).toMatchObject( { sites: [ { id: 'site-1' } ] } );
} );

it( 'imports appdata-v1.json from before the split', async () => {
	const legacyFile = path.join( appDataDir, 'Studio', 'appdata-v1.json' );
	writeJson( legacyFile, {
		version: 1,
		authToken: token,
		sites: [ { ...cliSite, sortOrder: 4, themeDetails: {} } ],
		snapshots: [],
		preferredEditor: 'vscode',
	} );

	const config = await readConfig();

	expect( config.sites ).toEqual( [ expect.objectContaining( { id: 'site-1', sortOrder: 4 } ) ] );
	expect( config.sites[ 0 ] ).not.toHaveProperty( 'themeDetails' );
	expect( config.preferences.preferredEditor ).toBe( 'vscode' );
	expect( config.providers.configs.wpcom ).toMatchObject( { token: 'token' } );
	expect( existsSync( legacyFile ) ).toBe( false );
	expect( existsSync( path.join( appDataDir, 'Studio', 'appdata-v1.deprecated.json' ) ) ).toBe(
		true
	);
} );

it( 'keeps sites already in cli.json over appdata-v1.json', async () => {
	writeJson( path.join( appDataDir, 'Studio', 'appdata-v1.json' ), {
		sites: [ { ...cliSite, id: 'old' } ],
	} );
	writeJson( path.join( configDir, 'cli.json' ), { version: 1, sites: [ cliSite ] } );

	expect( ( await readConfig() ).sites.map( ( { id } ) => id ) ).toEqual( [ 'site-1' ] );
} );

it( 'takes the sites of appdata-v1.json when cli.json has none', async () => {
	writeJson( path.join( appDataDir, 'Studio', 'appdata-v1.json' ), { sites: [ cliSite ] } );
	writeJson( path.join( configDir, 'cli.json' ), { version: 1, tosNoticeShownAt: 3 } );

	const config = await readConfig();

	expect( config.sites.map( ( { id } ) => id ) ).toEqual( [ 'site-1' ] );
	expect( config.cli.tosNoticeShownAt ).toBe( 3 );
} );
