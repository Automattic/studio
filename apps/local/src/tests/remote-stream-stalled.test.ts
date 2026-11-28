import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	pairDevice,
	request,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let test: TestRemoteServer;

beforeAll( async () => {
	test = await startRemoteTestServer( {
		// Sends a 200 KB site event every 10 ms.
		cliBinary: path.join( import.meta.dirname, 'fixtures', 'fake-cli-flood.mjs' ),
		// Long, so only the revocation closes the stream.
		remote: { label: 'Test Mac', studioVersion: '0.0.0-test', streamRecheckMs: 60_000 },
	} );
} );

afterAll( async () => {
	await test.stop();
} );

const sleep = ( ms: number ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

describe( 'a device that stops reading its event stream', () => {
	it( 'cannot crash the server once it is revoked', async () => {
		const uncaught: Error[] = [];
		const onUncaught = ( error: Error ) => uncaught.push( error );
		process.on( 'uncaughtException', onUncaught );

		const stalled = await pairDevice( test.server.port );
		const healthy = await pairDevice( test.server.port );
		const socket = net.connect( test.server.port, '127.0.0.1' );
		socket.on( 'error', () => undefined );
		try {
			await new Promise< void >( ( resolve ) => socket.once( 'connect', resolve ) );
			socket.write(
				`GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${ stalled.token }\r\n\r\n`
			);
			// Never read the answer: the kernel buffers fill, then the server's own.
			socket.pause();
			await sleep( 2000 );

			const revoked = await request( test.server.port, {
				method: 'DELETE',
				path: '/api/remote/devices/current',
				token: stalled.token,
			} );
			expect( revoked.status ).toBe( 204 );
			// The flood goes on: the next event is written after the server closed the stream.
			await sleep( 500 );

			expect( uncaught.map( ( error ) => error.message ) ).toEqual( [] );
			const health = await request( test.server.port, {
				path: '/api/health',
				token: healthy.token,
			} );
			expect( health.status ).toBe( 200 );
		} finally {
			socket.destroy();
			process.off( 'uncaughtException', onUncaught );
		}
	} );
} );
