import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as defaultBrowser from '@studio/common/lib/user-settings/default-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

// Driven over HTTP: the request validation and the `null`-clears-a-preference
// wire contract are what the browser UI actually depends on.

let server: LocalServer;
let configDir: string;

function writeAppConfig( config: unknown ): void {
	writeFileSync( path.join( configDir, 'app.json' ), JSON.stringify( config ), 'utf-8' );
}

// `{}` when absent: a rejected write leaves no app.json at all.
function readAppConfigFile(): Record< string, unknown > {
	const configPath = path.join( configDir, 'app.json' );
	return existsSync( configPath ) ? JSON.parse( readFileSync( configPath, 'utf-8' ) ) : {};
}

async function getPreferences(): Promise< Record< string, unknown > > {
	const response = await fetch( `${ server.url }/api/user-preferences` );
	expect( response.status ).toBe( 200 );
	return response.json();
}

async function patchPreferences( body: unknown ): Promise< Response > {
	return fetch( `${ server.url }/api/user-preferences`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );
}

async function postSortOrder( body: unknown ): Promise< Response > {
	return fetch( `${ server.url }/api/sites/sort-order`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );
}

beforeEach( async () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-prefs-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
	} );
} );

afterEach( async () => {
	vi.restoreAllMocks();
	await server.close();
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'reports the host default browser alongside installed applications', async () => {
	vi.spyOn( defaultBrowser, 'detectDefaultBrowser' ).mockResolvedValue( {
		name: 'Safari',
		browser: 'safari',
	} );
	const response = await fetch( `${ server.url }/api/installed-apps` );
	expect( response.status ).toBe( 200 );
	expect( await response.json() ).toMatchObject( {
		terminal: true,
		defaultBrowser: { name: 'Safari', browser: 'safari' },
	} );
} );

describe( 'GET/PATCH /api/user-preferences', () => {
	it( 'reports what the desktop stored', async () => {
		writeAppConfig( { preferredEditor: 'zed', preferredTerminal: 'iterm', colorScheme: 'dark' } );

		await expect( getPreferences() ).resolves.toMatchObject( {
			editor: 'zed',
			terminal: 'iterm',
			colorScheme: 'dark',
			analyticsEnabled: true,
		} );
	} );

	it( 'falls back to the desktop defaults when nothing is stored', async () => {
		await expect( getPreferences() ).resolves.toMatchObject( {
			editor: null,
			terminal: null,
			colorScheme: 'system',
			analyticsEnabled: true,
			defaultSiteDirectory: path.join( os.tmpdir(), 'studio-test-sites' ),
		} );
	} );

	it( 'persists a patch under the field names the desktop reads', async () => {
		const response = await patchPreferences( { colorScheme: 'dark', terminal: 'iterm' } );

		expect( response.status ).toBe( 204 );
		expect( readAppConfigFile() ).toMatchObject( {
			colorScheme: 'dark',
			preferredTerminal: 'iterm',
		} );
	} );

	it( 'treats null as a clear, leaving unrelated state alone', async () => {
		writeAppConfig( { sentryUserId: 'abc', preferredEditor: 'zed', quitSitesBehavior: 'stop' } );

		const response = await patchPreferences( { editor: null, quitSitesBehavior: null } );

		expect( response.status ).toBe( 204 );
		const config = readAppConfigFile();
		expect( config ).not.toHaveProperty( 'preferredEditor' );
		expect( config ).not.toHaveProperty( 'quitSitesBehavior' );
		expect( config ).toMatchObject( { sentryUserId: 'abc' } );
	} );

	it( 'routes locale and the analytics opt-out to shared.json', async () => {
		const response = await patchPreferences( { locale: 'fr', analyticsEnabled: false } );

		expect( response.status ).toBe( 204 );
		await expect( getPreferences() ).resolves.toMatchObject( {
			locale: 'fr',
			analyticsEnabled: false,
		} );
	} );

	it.each( [
		[ 'a value outside the supported set', { colorScheme: 'chartreuse' } ],
		[ 'a locale with no translations', { locale: 'xx-fake' } ],
	] )( 'rejects %s instead of storing it', async ( _label, body ) => {
		const response = await patchPreferences( body );

		expect( response.status ).toBe( 400 );
		expect( readAppConfigFile() ).toEqual( {} );
	} );
} );

describe( 'POST /api/sites/sort-order', () => {
	it( 'stores the order without disturbing the desktop-only metadata', async () => {
		writeAppConfig( {
			siteMetadata: { 'site-1': { sortOrder: 9000, siteIconPath: '/tmp/icon.png' } },
		} );

		const response = await postSortOrder( {
			updates: [
				{ siteId: 'site-1', sortOrder: 1000 },
				{ siteId: 'site-2', sortOrder: 2000 },
			],
		} );

		expect( response.status ).toBe( 204 );
		expect( readAppConfigFile().siteMetadata ).toEqual( {
			'site-1': { sortOrder: 1000, siteIconPath: '/tmp/icon.png' },
			'site-2': { sortOrder: 2000 },
		} );
	} );

	it( 'recovers from malformed site metadata instead of failing the write', async () => {
		writeAppConfig( { siteMetadata: 'not-an-object' } );

		const response = await postSortOrder( { updates: [ { siteId: 'site-1', sortOrder: 1000 } ] } );

		expect( response.status ).toBe( 204 );
		expect( readAppConfigFile().siteMetadata ).toEqual( { 'site-1': { sortOrder: 1000 } } );
	} );

	it( 'rejects a malformed payload', async () => {
		await expect( postSortOrder( { updates: 'nope' } ) ).resolves.toMatchObject( { status: 400 } );
	} );
} );

describe( '/api/onboarding-hints', () => {
	it( 'merges a patch into the progress the desktop stored', async () => {
		writeAppConfig( { onboardingHints: { tourCompletedVersion: 1, migratedFromClassic: true } } );

		const response = await fetch( `${ server.url }/api/onboarding-hints`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { tourCompletedVersion: 2 } ),
		} );

		expect( response.status ).toBe( 204 );
		const hints = await ( await fetch( `${ server.url }/api/onboarding-hints` ) ).json();
		expect( hints ).toEqual( { tourCompletedVersion: 2, migratedFromClassic: true } );
	} );
} );

describe( 'GET /api/site-defaults/path', () => {
	it( "proposes new sites under the desktop's default site directory", async () => {
		const siteDirectory = path.join( configDir, 'Sites' );
		writeAppConfig( { defaultSiteDirectory: siteDirectory } );

		const response = await fetch( `${ server.url }/api/site-defaults/path?name=My%20Site` );

		expect( ( await response.json() ).path ).toBe( path.join( siteDirectory, 'my-site' ) );
	} );
} );

describe( 'POST /api/site-defaults/folder', () => {
	const check = async ( folderPath: string ) =>
		fetch( `${ server.url }/api/site-defaults/folder`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { path: folderPath } ),
		} );

	it( 'says whether a typed folder in the site directory is empty or holds WordPress', async () => {
		writeAppConfig( { defaultSiteDirectory: configDir } );
		const wordPress = path.join( configDir, 'existing' );
		mkdirSync( path.join( wordPress, 'wp-content' ), { recursive: true } );
		mkdirSync( path.join( wordPress, 'wp-includes' ) );
		writeFileSync( path.join( wordPress, 'wp-load.php' ), '' );

		expect( await ( await check( path.join( configDir, 'new-site' ) ) ).json() ).toEqual( {
			path: path.join( configDir, 'new-site' ),
			name: 'new-site',
			isEmpty: true,
			isWordPress: false,
		} );
		expect( await ( await check( wordPress ) ).json() ).toMatchObject( {
			isEmpty: false,
			isWordPress: true,
		} );
		expect( ( await check( 'relative/site' ) ).status ).toBe( 400 );
		// Outside the home and site directories, the folder is left to `site create`.
		expect( await ( await check( path.parse( configDir ).root ) ).json() ).toMatchObject( {
			isEmpty: true,
			isWordPress: false,
		} );
	} );
} );

describe( 'GET/PATCH /api/onboarding', () => {
	it( 'shares the desktop completion flag and retains other settings', async () => {
		expect( await ( await fetch( `${ server.url }/api/onboarding` ) ).json() ).toBe( false );
		writeAppConfig( { colorScheme: 'dark', onboardingHints: { tourDismissedVersion: 2 } } );
		const response = await fetch( `${ server.url }/api/onboarding`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { completed: true } ),
		} );
		expect( response.status ).toBe( 204 );
		expect( await ( await fetch( `${ server.url }/api/onboarding` ) ).json() ).toBe( true );
		expect( readAppConfigFile() ).toMatchObject( {
			colorScheme: 'dark',
			onboardingHints: { tourDismissedVersion: 2 },
			onboardingCompleted: true,
		} );
	} );

	it.each( [ {}, { completed: 'true' }, { completed: null } ] )(
		'rejects invalid completion: %j',
		async ( body ) => {
			const response = await fetch( `${ server.url }/api/onboarding`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( body ),
			} );
			expect( response.status ).toBe( 400 );
			expect( readAppConfigFile().onboardingCompleted ).toBeUndefined();
		}
	);
} );

it( 'shares the browser preference over HTTP and clears it back to the OS default', async () => {
	expect( ( await getPreferences() ).browser ).toBeNull();
	expect( ( await patchPreferences( { browser: 'chrome' } ) ).status ).toBe( 204 );
	expect( ( await getPreferences() ).browser ).toBe( 'chrome' );
	expect( readAppConfigFile().preferredBrowser ).toBe( 'chrome' );
	expect( ( await patchPreferences( { browser: 'unknown' } ) ).status ).toBe( 400 );
	expect( ( await patchPreferences( { browser: null } ) ).status ).toBe( 204 );
	expect( ( await getPreferences() ).browser ).toBeNull();
} );
