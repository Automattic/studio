import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	pairDevice,
	request,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let test: TestRemoteServer;
let storePath: string;

beforeAll( async () => {
	test = await startRemoteTestServer();
	storePath = path.join( test.configDir, 'remote.json' );
} );

afterEach( () => {
	rmSync( storePath, { recursive: true, force: true } );
	vi.restoreAllMocks();
} );

afterAll( async () => {
	await test.stop();
} );

describe( 'a store that cannot be read', () => {
	it( 'does not put the config directory in an unauthenticated answer', async () => {
		const logged = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		// A directory where the file should be makes every read fail with EISDIR.
		mkdirSync( storePath );

		const reply = await request( test.server.port, { path: '/.well-known/studio/remote' } );

		expect( reply.status ).toBe( 500 );
		expect( reply.text ).not.toContain( test.configDir );
		expect( reply.json ).toEqual( { error: 'Internal error' } );
		expect( logged ).toHaveBeenCalled();
	} );

	it( 'does not put the config directory in an answer to a bearer token', async () => {
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		mkdirSync( storePath );

		const reply = await request( test.server.port, { path: '/api/health', token: 'anything' } );

		expect( reply.status ).toBe( 500 );
		expect( reply.text ).not.toContain( test.configDir );
		expect( reply.json ).toEqual( { error: 'Internal error' } );
	} );

	it( 'fails closed on a store written by a newer build', async () => {
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		const { token } = await pairDevice( test.server.port );
		expect( ( await request( test.server.port, { path: '/api/health', token } ) ).status ).toBe(
			200
		);

		writeFileSync( storePath, JSON.stringify( { version: 2, instanceId: 'x', devices: [] } ) );

		const reply = await request( test.server.port, { path: '/api/health', token } );
		expect( reply.status ).toBe( 500 );
	} );
} );
