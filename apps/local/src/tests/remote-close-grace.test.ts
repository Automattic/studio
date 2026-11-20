import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRemoteTestServer, type TestRemoteServer } from './utils/remote-test-utils';

let test: TestRemoteServer;
let client: net.Socket | undefined;

beforeAll( async () => {
	test = await startRemoteTestServer();
} );

afterAll( async () => {
	client?.destroy();
	await test.stop().catch( () => undefined );
} );

describe( 'closing a remote mode server', () => {
	// Pairing needs no token, so anyone who reaches the address can open a request
	// and never finish its body.
	it( 'does not wait for a request whose body never arrives', async () => {
		client = net.connect( test.server.port, '127.0.0.1' );
		await new Promise( ( resolve ) => client!.once( 'connect', resolve ) );
		client.write(
			'POST /api/remote/pair HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"code":'
		);
		await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );

		const started = Date.now();
		await test.server.close();

		expect( Date.now() - started ).toBeLessThan( 5000 );
	}, 15_000 );
} );
