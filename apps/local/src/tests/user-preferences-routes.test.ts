import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

/**
 * The routes the browser UI talks to, exercised over HTTP so the request
 * validation and the `null`-clears-a-preference wire contract are covered —
 * the module-level tests call past both.
 */

let server: LocalServer;
let configDir: string;

function writeAppConfig( config: unknown ): void {
	writeFileSync( path.join( configDir, 'app.json' ), JSON.stringify( config ), 'utf-8' );
}

// `{}` when absent: a rejected write leaves no app.json at all, which callers
// assert the same way as "the field wasn't stored".
function readAppConfigFile(): Record< string, unknown > {
	const configPath = path.join( configDir, 'app.json' );
	return existsSync( configPath ) ? JSON.parse( readFileSync( configPath, 'utf-8' ) ) : {};
}

function readSharedConfigFile(): Record< string, unknown > {
	return JSON.parse( readFileSync( path.join( configDir, 'shared.json' ), 'utf-8' ) );
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

beforeEach( async () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-prefs-routes-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
	} );
} );

afterEach( async () => {
	await server.close();
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

describe( 'GET/PATCH /api/user-preferences', () => {
	it( 'reports what the desktop stored', async () => {
		writeAppConfig( { preferredEditor: 'zed', colorScheme: 'dark' } );

		await expect( getPreferences() ).resolves.toMatchObject( {
			editor: 'zed',
			colorScheme: 'dark',
			analyticsEnabled: true,
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

	it( 'treats null as a clear', async () => {
		writeAppConfig( { preferredEditor: 'zed', quitSitesBehavior: 'stop' } );

		const response = await patchPreferences( { editor: null, quitSitesBehavior: null } );

		expect( response.status ).toBe( 204 );
		const config = readAppConfigFile();
		expect( config ).not.toHaveProperty( 'preferredEditor' );
		expect( config ).not.toHaveProperty( 'quitSitesBehavior' );
	} );

	it( 'routes locale and the analytics opt-out to shared.json', async () => {
		const response = await patchPreferences( { locale: 'fr', analyticsEnabled: false } );

		expect( response.status ).toBe( 204 );
		expect( readSharedConfigFile() ).toMatchObject( { locale: 'fr', analyticsOptOut: true } );
		await expect( getPreferences() ).resolves.toMatchObject( {
			locale: 'fr',
			analyticsEnabled: false,
		} );
	} );

	it( 'rejects a value outside the supported set instead of storing it', async () => {
		const response = await patchPreferences( { colorScheme: 'chartreuse' } );

		expect( response.status ).toBe( 400 );
		expect( readAppConfigFile() ).not.toHaveProperty( 'colorScheme' );
	} );

	// Reported rather than silently dropped: a locale we ship no translations
	// for would otherwise 204 and leave the UI in the previous language.
	it( 'rejects a locale with no translations', async () => {
		const response = await patchPreferences( { locale: 'xx-fake' } );

		expect( response.status ).toBe( 400 );
		expect( await getPreferences() ).not.toHaveProperty( 'locale' );
	} );
} );

describe( 'POST /api/sites/sort-order', () => {
	async function postSortOrder( body: unknown ): Promise< Response > {
		return fetch( `${ server.url }/api/sites/sort-order`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( body ),
		} );
	}

	it( 'stores the order where the desktop reads it', async () => {
		const response = await postSortOrder( {
			updates: [
				{ siteId: 'site-1', sortOrder: 2000 },
				{ siteId: 'site-2', sortOrder: 1000 },
			],
		} );

		expect( response.status ).toBe( 204 );
		expect( readAppConfigFile().siteMetadata ).toEqual( {
			'site-1': { sortOrder: 2000 },
			'site-2': { sortOrder: 1000 },
		} );
	} );

	it( 'rejects a malformed payload', async () => {
		const response = await postSortOrder( { updates: 'nope' } );

		expect( response.status ).toBe( 400 );
	} );
} );
