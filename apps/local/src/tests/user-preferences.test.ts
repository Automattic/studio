import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	readSiteSortOrders,
	readUserPreferences,
	writeSiteSortOrders,
	writeUserPreferences,
	type UserPreferencesContext,
} from '../user-preferences';
import type { InstalledApps } from '@studio/common/lib/user-settings/installed-apps';

const SITES_ROOT = '/Users/test/Studio';

// Pinned rather than detected, so the expectations don't depend on what this
// machine happens to have installed.
const INSTALLED_APPS = { zed: true, vscode: true } as unknown as InstalledApps;

const context: UserPreferencesContext = { sitesRoot: SITES_ROOT, installedApps: INSTALLED_APPS };

// What the desktop shows for a preference the user has never touched. The two
// front ends have to agree on these, so they're asserted as one block.
const DESKTOP_DEFAULTS = {
	editor: 'vscode',
	terminal: 'terminal',
	colorScheme: 'light',
	quitSitesBehavior: undefined,
	defaultSiteDirectory: SITES_ROOT,
};

let configDir: string;

function writeAppConfig( config: unknown ): void {
	writeFileSync( path.join( configDir, 'app.json' ), JSON.stringify( config ), 'utf-8' );
}

function readAppConfigFile(): Record< string, unknown > {
	return JSON.parse( readFileSync( path.join( configDir, 'app.json' ), 'utf-8' ) );
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
	it( 'falls back to the desktop defaults when nothing is stored', async () => {
		await expect( readUserPreferences( context ) ).resolves.toMatchObject( {
			...DESKTOP_DEFAULTS,
			locale: undefined,
			analyticsEnabled: true,
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

		await expect( readUserPreferences( context ) ).resolves.toMatchObject( {
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

		await expect( readUserPreferences( context ) ).resolves.toMatchObject( DESKTOP_DEFAULTS );
	} );
} );

describe( 'writeUserPreferences', () => {
	it( 'clears a preference on null so its default applies again', async () => {
		writeAppConfig( { preferredEditor: 'zed', quitSitesBehavior: 'stop' } );

		await writeUserPreferences( { editor: null, quitSitesBehavior: null } );

		await expect( readUserPreferences( context ) ).resolves.toMatchObject( {
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

		await expect( readSiteSortOrders() ).resolves.toEqual(
			new Map( [
				[ 'site-1', 2000 ],
				[ 'site-3', 1000 ],
			] )
		);
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
		await writeSiteSortOrders( [ { siteId: 'site-1', sortOrder: 1000 } ] );

		expect( readAppConfigFile().siteMetadata ).toEqual( { 'site-1': { sortOrder: 1000 } } );
	} );
} );
