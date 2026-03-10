import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SocketMessageDecoder, SocketServer, SocketRequestClient } from '../socket';

function encodeTestMessage( message: unknown ): Buffer {
	const json = JSON.stringify( message );
	const body = Buffer.from( json, 'utf8' );
	const header = Buffer.allocUnsafe( 4 );
	header.writeUInt32BE( body.length, 0 );
	return Buffer.concat( [ header, body ] );
}

function createEndpoint() {
	const suffix = `${ process.pid }-${ Date.now().toString( 36 ) }`;
	return process.platform === 'win32'
		? `\\\\.\\pipe\\studio-socket-test-${ suffix }`
		: path.join( os.tmpdir(), `s-${ suffix }.sock` );
}

async function closeServer( server: net.Server ) {
	await new Promise< void >( ( resolve ) => {
		server.close( () => resolve() );
	} );
}

async function canBindUnixSocket(): Promise< boolean > {
	if ( process.platform === 'win32' ) {
		return true;
	}

	const endpoint = createEndpoint();
	const server = net.createServer();
	return new Promise< boolean >( ( resolve ) => {
		server.once( 'error', () => {
			resolve( false );
		} );
		server.listen( endpoint, async () => {
			await closeServer( server );
			try {
				fs.unlinkSync( endpoint );
			} catch {
				// Ignore cleanup failures.
			}
			resolve( true );
		} );
	} );
}

describe( 'socket', () => {
	const unixEndpointsToCleanup: string[] = [];

	afterEach( () => {
		if ( process.platform === 'win32' ) {
			return;
		}

		for ( const endpoint of unixEndpointsToCleanup.splice( 0 ) ) {
			try {
				fs.unlinkSync( endpoint );
			} catch {
				// Ignore cleanup failures.
			}
		}
	} );

	it( 'decodes messages split across chunks', () => {
		const message = { event: 'site-updated', data: { siteId: 'site-1' } };
		const encoded = encodeTestMessage( message );
		const decoder = new SocketMessageDecoder();

		expect( decoder.write( encoded.subarray( 0, 3 ) ) ).toEqual( [] );
		expect( decoder.write( encoded.subarray( 3 ) ) ).toEqual( [ message ] );
	} );

	it( 'sends queued messages from pusher to puller', async ( { skip } ) => {
		if ( ! ( await canBindUnixSocket() ) ) {
			skip( true, 'Environment does not support Unix sockets' );
		}

		const endpoint = createEndpoint();
		if ( process.platform !== 'win32' ) {
			unixEndpointsToCleanup.push( endpoint );
		}

		const received: unknown[] = [];
		const puller = new SocketServer( endpoint, 1000 );
		puller.on( 'message', ( { message } ) => {
			received.push( message );
		} );
		await puller.listen();

		const pusher = new SocketRequestClient( endpoint, 1000 );
		await Promise.all( [ pusher.send( { idx: 1 } ), pusher.send( { idx: 2 } ) ] );

		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		expect( received ).toEqual( [ { idx: 1 }, { idx: 2 } ] );

		await puller.close();
	} );

	it( 'sends a message and waits for a response', async ( { skip } ) => {
		if ( ! ( await canBindUnixSocket() ) ) {
			skip( true, 'Environment does not support Unix sockets' );
		}

		const endpoint = createEndpoint();
		if ( process.platform !== 'win32' ) {
			unixEndpointsToCleanup.push( endpoint );
		}

		const server = net.createServer( ( socket ) => {
			const decoder = new SocketMessageDecoder();
			socket.on( 'data', ( chunk ) => {
				for ( const message of decoder.write( chunk ) ) {
					socket.end( encodeTestMessage( { ok: true, echo: message } ) );
				}
			} );
		} );

		await new Promise< void >( ( resolve ) => {
			server.listen( endpoint, () => resolve() );
		} );

		const client = new SocketRequestClient( endpoint, 1000 );
		const response = await client.sendAndWaitForResponse( { idx: 1 } );

		expect( response ).toEqual( { ok: true, echo: { idx: 1 } } );

		await closeServer( server );
	} );

	it( 'recovers from stale unix socket file on bind', async ( { skip } ) => {
		if ( process.platform === 'win32' ) {
			skip( true, 'Does not apply on Windows' );
		}
		if ( ! ( await canBindUnixSocket() ) ) {
			skip( true, 'Environment does not support Unix sockets' );
		}

		const endpoint = createEndpoint();
		unixEndpointsToCleanup.push( endpoint );
		fs.writeFileSync( endpoint, 'stale' );

		const server = new SocketServer( endpoint, 1000 );
		await expect( server.listen() ).resolves.toBeUndefined();
		await server.close();
	} );
} );
