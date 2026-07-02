import { randomUUID } from 'crypto';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SocketRequestClient } from '../lib/socket';

function makeTestEndpoint(): string {
	const id = randomUUID();
	return process.platform === 'win32'
		? `\\\\.\\pipe\\studio-test-${ id }`
		: path.join( os.tmpdir(), `studio-test-${ id }.sock` );
}

describe( 'SocketRequestClient', () => {
	let server: net.Server;
	const acceptedSockets: net.Socket[] = [];

	afterEach( async () => {
		acceptedSockets.forEach( ( socket ) => socket.destroy() );
		acceptedSockets.length = 0;
		await new Promise< void >( ( resolve ) => server.close( () => resolve() ) );
	} );

	it( 'rejects when the peer accepts the connection but never responds', async () => {
		const endpoint = makeTestEndpoint();
		server = net.createServer( ( socket ) => {
			// Accept and go silent, like a wedged daemon.
			acceptedSockets.push( socket );
		} );
		await new Promise< void >( ( resolve ) => server.listen( endpoint, resolve ) );

		const client = new SocketRequestClient( endpoint, 1000, 100 );
		await expect( client.sendAndWaitForResponse( { type: 'ping' } ) ).rejects.toThrow(
			/response timeout/
		);
	} );
} );
