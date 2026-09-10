import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';
import * as openInOs from '../open-in-os';

// Driven over HTTP: a mismatch with the desktop's IPC path fails silently, so
// the wire contract is what's worth pinning.

let server: LocalServer;
let configDir: string;
let sitePath: string;

const SITE_ID = 'site-1';

function writeDebugLog(): void {
	const wpContent = path.join( sitePath, 'wp-content' );
	mkdirSync( wpContent, { recursive: true } );
	writeFileSync( path.join( wpContent, 'debug.log' ), 'PHP Notice: something\n', 'utf-8' );
}

beforeEach( async () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-debug-log-' ) );
	sitePath = mkdtempSync( path.join( os.tmpdir(), 'studio-debug-log-site-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	writeFileSync(
		path.join( configDir, 'cli.json' ),
		JSON.stringify( { sites: [ { id: SITE_ID, path: sitePath } ] } ),
		'utf-8'
	);
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
	} );
} );

afterEach( async () => {
	await server.close();
	vi.restoreAllMocks();
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
	rmSync( sitePath, { recursive: true, force: true } );
} );

describe( 'GET /api/sites/:id/debug-log', () => {
	it( 'reports no log before WordPress writes one', async () => {
		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/debug-log` );

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( { exists: false } );
	} );

	it( 'reports the log once it exists', async () => {
		writeDebugLog();

		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/debug-log` );

		await expect( response.json() ).resolves.toEqual( { exists: true } );
	} );
} );

describe( 'POST /api/sites/:id/debug-log/open', () => {
	it( 'opens the log in the OS default app', async () => {
		const openPath = vi.spyOn( openInOs, 'openPath' ).mockResolvedValue();
		writeDebugLog();

		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/debug-log/open`, {
			method: 'POST',
		} );

		expect( response.status ).toBe( 204 );
		expect( openPath ).toHaveBeenCalledWith( path.join( sitePath, 'wp-content', 'debug.log' ) );
	} );

	// `openPath` on a missing file is a silent no-op; the guard is what surfaces it.
	it( '404s when the log is gone, without asking the OS to open it', async () => {
		const openPath = vi.spyOn( openInOs, 'openPath' ).mockResolvedValue();

		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/debug-log/open`, {
			method: 'POST',
		} );

		expect( response.status ).toBe( 404 );
		expect( openPath ).not.toHaveBeenCalled();
	} );

	it( '404s for an unknown site', async () => {
		const response = await fetch( `${ server.url }/api/sites/nope/debug-log/open`, {
			method: 'POST',
		} );

		expect( response.status ).toBe( 404 );
	} );
} );
