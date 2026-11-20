import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	pairDevice,
	request,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

const GUARD_MESSAGE = 'Remote mode accepts a text prompt only, without attachments';

let test: TestRemoteServer;
let sessionsRoot: string;
let token: string;

beforeAll( async () => {
	sessionsRoot = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-sessions-' ) );
	test = await startRemoteTestServer( {
		cliBinary: path.join( import.meta.dirname, 'fixtures', 'fake-cli.mjs' ),
		sessionsRoot,
	} );
	( { token } = await pairDevice( test.server.port ) );
} );

afterAll( async () => {
	await test.stop();
	rmSync( sessionsRoot, { recursive: true, force: true } );
} );

function postMessage( body: unknown ) {
	return request( test.server.port, {
		method: 'POST',
		path: '/api/sessions/no-such-session/messages',
		token,
		body,
	} );
}

describe( 'a message from a paired device', () => {
	it.each( [
		[ 'images', { images: [ { mimeType: 'image/png', data: 'AAAA' } ] } ],
		[ 'files', { files: [ { name: 'a.txt', data: 'AAAA' } ] } ],
		[ 'visualAnnotations', { visualAnnotations: [ { id: 'a' } ] } ],
		[ 'displayMessage', { displayMessage: 'something else' } ],
		[ 'an unknown field', { somethingNew: true } ],
		[ 'empty attachment lists', { images: [], files: [] } ],
	] )( 'is refused with %s', async ( _name, extra ) => {
		const reply = await postMessage( { prompt: 'hello', ...extra } );
		expect( reply.status ).toBe( 400 );
		expect( reply.json?.error ).toBe( GUARD_MESSAGE );
	} );

	it( 'is refused without a prompt', async () => {
		const reply = await postMessage( { turnId: 't1' } );
		expect( reply.status ).toBe( 400 );
		expect( reply.json?.error ).toBe( GUARD_MESSAGE );
	} );

	it( 'gets past the guard with only a prompt', async () => {
		const reply = await postMessage( { prompt: 'hello' } );
		expect( [ 401, 403 ] ).not.toContain( reply.status );
		expect( reply.json?.error ).not.toBe( GUARD_MESSAGE );
	} );

	it( 'gets past the guard with a prompt and a turn id', async () => {
		const reply = await postMessage( { prompt: 'hello', turnId: 't1' } );
		expect( [ 401, 403 ] ).not.toContain( reply.status );
		expect( reply.json?.error ).not.toBe( GUARD_MESSAGE );
	} );
} );
