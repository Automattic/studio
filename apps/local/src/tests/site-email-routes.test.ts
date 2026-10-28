import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';
import * as openInOs from '../open-in-os';

// Driven over HTTP: a mismatch with the desktop's IPC path fails silently, so
// the wire contract is what's worth pinning.

let server: LocalServer;
let configDir: string;

const SITE_ID = 'site-1';
const EMAIL_ID = '20261028-090000-000001-aaaaaa.eml';

beforeEach( async () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-site-email-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	writeFileSync(
		path.join( configDir, 'cli.json' ),
		JSON.stringify( { sites: [ { id: SITE_ID, path: path.join( configDir, 'site' ) } ] } ),
		'utf-8'
	);
	mkdirSync( getSiteEmailDirectory( SITE_ID ), { recursive: true } );
	writeFileSync(
		path.join( getSiteEmailDirectory( SITE_ID ), EMAIL_ID ),
		'Date: Wed, 28 Oct 2026 09:00:00 +0000\nTo: admin@example.com\nSubject: Hello\nFrom: wordpress@localhost\n\nHi there\n',
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
} );

describe( 'GET /api/sites/:id/emails', () => {
	it( 'lists the email the site sent', async () => {
		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/emails` );

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( [
			{
				id: EMAIL_ID,
				subject: 'Hello',
				from: { name: '', address: 'wordpress@localhost' },
				to: [ { name: '', address: 'admin@example.com' } ],
				date: '2026-10-28T09:00:00.000Z',
			},
		] );
	} );

	it( '404s for an unknown site', async () => {
		const response = await fetch( `${ server.url }/api/sites/nope/emails` );

		expect( response.status ).toBe( 404 );
	} );
} );

describe( 'GET /api/sites/:id/emails/:emailId', () => {
	it( 'reads one email', async () => {
		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/emails/${ EMAIL_ID }` );

		await expect( response.json() ).resolves.toMatchObject( {
			id: EMAIL_ID,
			subject: 'Hello',
			text: 'Hi there\n',
			html: null,
		} );
	} );

	it( 'answers null for an email that is not there', async () => {
		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/emails/missing.eml` );

		await expect( response.json() ).resolves.toBeNull();
	} );
} );

describe( 'POST /api/sites/:id/open-email-folder', () => {
	it( 'opens the folder, making it first for a site that has sent no email', async () => {
		const openPath = vi.spyOn( openInOs, 'openPath' ).mockResolvedValue();
		rmSync( getSiteEmailDirectory( SITE_ID ), { recursive: true, force: true } );

		const response = await fetch( `${ server.url }/api/sites/${ SITE_ID }/open-email-folder`, {
			method: 'POST',
		} );

		expect( response.status ).toBe( 204 );
		expect( existsSync( getSiteEmailDirectory( SITE_ID ) ) ).toBe( true );
		expect( openPath ).toHaveBeenCalledWith( getSiteEmailDirectory( SITE_ID ) );
	} );

	it( '404s for an unknown site, without asking the OS to open anything', async () => {
		const openPath = vi.spyOn( openInOs, 'openPath' ).mockResolvedValue();

		const response = await fetch( `${ server.url }/api/sites/nope/open-email-folder`, {
			method: 'POST',
		} );

		expect( response.status ).toBe( 404 );
		expect( openPath ).not.toHaveBeenCalled();
	} );
} );
