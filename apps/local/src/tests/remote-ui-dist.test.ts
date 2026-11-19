import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';
import {
	baseServerOptions,
	request,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let uiDist: string;
let test: TestRemoteServer;
let uiServer: LocalServer;

beforeAll( async () => {
	uiDist = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-ui-' ) );
	writeFileSync( path.join( uiDist, 'index.local.html' ), '<!doctype html><title>Studio</title>' );
	test = await startRemoteTestServer( { uiDist } );
	// The same directory served without remote mode, to prove the page is there to be served.
	uiServer = await startLocalServer( { ...baseServerOptions, host: '127.0.0.1', uiDist } );
} );

afterAll( async () => {
	await uiServer.close();
	await test.stop();
	rmSync( uiDist, { recursive: true, force: true } );
} );

describe( 'the browser UI', () => {
	const html = { accept: 'text/html' };

	it( 'is served by studio ui', async () => {
		const reply = await request( uiServer.port, { path: '/', headers: html } );
		expect( reply.status ).toBe( 200 );
		expect( reply.text ).toContain( '<title>Studio</title>' );
	} );

	it( 'is not served in remote mode', async () => {
		for ( const pagePath of [ '/', '/index.local.html', '/sessions/abc' ] ) {
			const reply = await request( test.server.port, { path: pagePath, headers: html } );
			expect( `${ pagePath } ${ reply.status }` ).toBe( `${ pagePath } 404` );
		}
	} );
} );
