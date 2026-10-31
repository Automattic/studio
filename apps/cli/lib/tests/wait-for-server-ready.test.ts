import http from 'http';
import net from 'net';
import { waitForServerReady } from 'cli/lib/wait-for-server-ready';

function listen( server: net.Server, port = 0 ): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		server.once( 'error', reject );
		server.listen( port, '127.0.0.1', () =>
			resolve( ( server.address() as net.AddressInfo ).port )
		);
	} );
}

function close( server: net.Server ): Promise< void > {
	return new Promise( ( resolve ) => server.close( () => resolve() ) );
}

async function getFreePort(): Promise< number > {
	const probe = net.createServer();
	const port = await listen( probe );
	await close( probe );
	return port;
}

describe( 'waitForServerReady', () => {
	it( 'resolves once the server answers, whatever the status', async () => {
		const server = http.createServer( ( _req, res ) => {
			res.writeHead( 500 );
			res.end( 'error' );
		} );
		const port = await listen( server );
		try {
			await expect(
				waitForServerReady( `http://127.0.0.1:${ port }/`, {
					timeoutMs: 5_000,
					pollIntervalMs: 20,
				} )
			).resolves.toBeUndefined();
		} finally {
			await close( server );
		}
	} );

	it( 'keeps polling until the server starts', async () => {
		const port = await getFreePort();
		const server = http.createServer( ( _req, res ) => res.end( 'ok' ) );
		setTimeout( () => void listen( server, port ), 150 );
		try {
			await expect(
				waitForServerReady( `http://127.0.0.1:${ port }/`, {
					timeoutMs: 5_000,
					pollIntervalMs: 20,
				} )
			).resolves.toBeUndefined();
		} finally {
			await close( server );
		}
	} );

	it( 'does not follow redirects', async () => {
		const server = http.createServer( ( _req, res ) => {
			res.writeHead( 302, { Location: 'http://127.0.0.1:1/' } );
			res.end();
		} );
		const port = await listen( server );
		try {
			await expect(
				waitForServerReady( `http://127.0.0.1:${ port }/`, {
					timeoutMs: 1_000,
					pollIntervalMs: 20,
				} )
			).resolves.toBeUndefined();
		} finally {
			await close( server );
		}
	} );

	it( 'times out when nothing answers', async () => {
		const port = await getFreePort();
		await expect(
			waitForServerReady( `http://127.0.0.1:${ port }/`, { timeoutMs: 100, pollIntervalMs: 20 } )
		).rejects.toThrow( /did not respond within 100ms/ );
	} );

	it( 'stops waiting once aborted', async () => {
		const port = await getFreePort();
		const controller = new AbortController();
		setTimeout( () => controller.abort( new Error( 'exited' ) ), 50 );
		await expect(
			waitForServerReady( `http://127.0.0.1:${ port }/`, {
				timeoutMs: 5_000,
				pollIntervalMs: 20,
				signal: controller.signal,
			} )
		).rejects.toThrow( 'exited' );
	} );
} );
