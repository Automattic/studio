import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	readSiteSortOrders,
	readUserPreferences,
	writeSiteSortOrders,
	writeUserPreferences,
} from '../user-preferences';

// The editor fallback scans the machine for installed apps; pin it so the
// expectations don't depend on what this machine happens to have.
vi.mock( '@studio/common/lib/user-settings/installed-apps', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	detectInstalledApps: () => ( { zed: true, vscode: true } ),
} ) );

const SITES_ROOT = '/Users/test/Studio';

let configDir: string;

function writeAppConfig( config: unknown ): void {
	writeFileSync( path.join( configDir, 'app.json' ), JSON.stringify( config ), 'utf-8' );
}

function readAppConfigFile(): Record< string, unknown > {
	return JSON.parse( readFileSync( path.join( configDir, 'app.json' ), 'utf-8' ) );
}

function readSharedConfigFile(): Record< string, unknown > {
	return JSON.parse( readFileSync( path.join( configDir, 'shared.json' ), 'utf-8' ) );
}

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-prefs-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

describe( 'readUserPreferences', () => {
	// These defaults are the desktop's (see apps/studio's user-settings
	// handlers); the two front ends must agree on an untouched preference.
	it( 'falls back to the desktop defaults when nothing is stored', async () => {
		await expect( readUserPreferences( SITES_ROOT ) ).resolves.toEqual( {
			editor: 'vscode',
			terminal: 'terminal',
			colorScheme: 'light',
			quitSitesBehavior: undefined,
			locale: undefined,
			analyticsEnabled: true,
			defaultSiteDirectory: SITES_ROOT,
			agenticFeaturesEnabled: true,
		} );
	} );

	it( 'returns the values the desktop stored', async () => {
		writeAppConfig( {
			preferredEditor: 'zed',
			preferredTerminal: 'iterm',
			colorScheme: 'dark',
			quitSitesBehavior: 'leave-running',
			defaultSiteDirectory: '/Users/test/Elsewhere',
			agenticFeaturesEnabled: false,
		} );

		await expect( readUserPreferences( SITES_ROOT ) ).resolves.toMatchObject( {
			editor: 'zed',
			terminal: 'iterm',
			colorScheme: 'dark',
			quitSitesBehavior: 'leave-running',
			defaultSiteDirectory: '/Users/test/Elsewhere',
			agenticFeaturesEnabled: false,
		} );
	} );

	it( 'falls back rather than surfacing unusable stored values', async () => {
		writeAppConfig( {
			preferredEditor: 'notepad',
			preferredTerminal: 'nonsense',
			colorScheme: 'chartreuse',
			quitSitesBehavior: 42,
			defaultSiteDirectory: '',
		} );

		await expect( readUserPreferences( SITES_ROOT ) ).resolves.toMatchObject( {
			editor: 'vscode',
			terminal: 'terminal',
			colorScheme: 'light',
			quitSitesBehavior: undefined,
			defaultSiteDirectory: SITES_ROOT,
		} );
	} );
} );

describe( 'writeUserPreferences', () => {
	it( 'persists under the field names the desktop reads', async () => {
		await writeUserPreferences( {
			editor: 'zed',
			terminal: 'iterm',
			colorScheme: 'dark',
			quitSitesBehavior: 'stop',
			agenticFeaturesEnabled: false,
		} );

		expect( readAppConfigFile() ).toMatchObject( {
			preferredEditor: 'zed',
			preferredTerminal: 'iterm',
			colorScheme: 'dark',
			quitSitesBehavior: 'stop',
			agenticFeaturesEnabled: false,
		} );
	} );

	it( 'clears a preference on null so its default applies again', async () => {
		writeAppConfig( { preferredEditor: 'zed', quitSitesBehavior: 'stop' } );

		await writeUserPreferences( { editor: null, quitSitesBehavior: null } );

		const config = readAppConfigFile();
		expect( config ).not.toHaveProperty( 'preferredEditor' );
		expect( config ).not.toHaveProperty( 'quitSitesBehavior' );
		await expect( readUserPreferences( SITES_ROOT ) ).resolves.toMatchObject( {
			editor: 'vscode',
			quitSitesBehavior: undefined,
		} );
	} );

	it( 'leaves unrelated app.json state untouched', async () => {
		writeAppConfig( { version: 1, sentryUserId: 'abc', windowBounds: { x: 1, y: 2 } } );

		await writeUserPreferences( { colorScheme: 'dark' } );

		expect( readAppConfigFile() ).toMatchObject( {
			version: 1,
			sentryUserId: 'abc',
			windowBounds: { x: 1, y: 2 },
			colorScheme: 'dark',
		} );
	} );

	it( 'routes locale and the analytics opt-out to shared.json', async () => {
		await writeUserPreferences( { locale: 'fr', analyticsEnabled: false } );

		expect( readSharedConfigFile() ).toMatchObject( { locale: 'fr', analyticsOptOut: true } );
		await expect( readUserPreferences( SITES_ROOT ) ).resolves.toMatchObject( {
			locale: 'fr',
			analyticsEnabled: false,
		} );
	} );

	it( 'ignores a locale with no translations rather than storing it', async () => {
		await writeUserPreferences( { locale: 'xx-fake' } );

		await expect( readUserPreferences( SITES_ROOT ) ).resolves.toMatchObject( {
			locale: undefined,
		} );
	} );
} );

describe( 'site sort orders', () => {
	it( 'reads the desktop’s manual order, skipping sites that have none', async () => {
		writeAppConfig( {
			siteMetadata: {
				'site-1': { sortOrder: 2000 },
				'site-2': { siteIconPath: '/tmp/icon.png' },
				'site-3': { sortOrder: 1000 },
			},
		} );

		const orders = await readSiteSortOrders();

		expect( [ ...orders ] ).toEqual( [
			[ 'site-1', 2000 ],
			[ 'site-3', 1000 ],
		] );
	} );

	it( 'keeps the desktop-only metadata alongside the order it writes', async () => {
		writeAppConfig( {
			siteMetadata: {
				'site-1': { sortOrder: 9000, siteIconPath: '/tmp/icon.png', autoStart: true },
				'site-2': { themeDetails: { name: 'Twenty Twenty-Four' } },
			},
		} );

		await writeSiteSortOrders( [
			{ siteId: 'site-1', sortOrder: 1000 },
			{ siteId: 'site-2', sortOrder: 2000 },
		] );

		expect( readAppConfigFile().siteMetadata ).toEqual( {
			'site-1': { sortOrder: 1000, siteIconPath: '/tmp/icon.png', autoStart: true },
			'site-2': { sortOrder: 2000, themeDetails: { name: 'Twenty Twenty-Four' } },
		} );
	} );

	it( 'recovers from malformed site metadata instead of failing the write', async () => {
		writeAppConfig( { siteMetadata: 'not-an-object' } );

		await expect( readSiteSortOrders() ).resolves.toEqual( new Map() );
		await expect(
			writeSiteSortOrders( [ { siteId: 'site-1', sortOrder: 1000 } ] )
		).resolves.toBeUndefined();
		expect( readAppConfigFile().siteMetadata ).toEqual( { 'site-1': { sortOrder: 1000 } } );
	} );
} );
