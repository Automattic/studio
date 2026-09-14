import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe( 'portFinder STUDIO_BASE_PORT', () => {
	afterEach( () => {
		delete process.env.STUDIO_BASE_PORT;
		vi.resetModules();
	} );

	it( 'starts scanning from STUDIO_BASE_PORT when set', async () => {
		process.env.STUDIO_BASE_PORT = '9981';
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );
		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThanOrEqual( 9981 );
	} );

	it( 'falls back to 8881 when STUDIO_BASE_PORT is not a number', async () => {
		process.env.STUDIO_BASE_PORT = 'not-a-number';
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );
		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThanOrEqual( 8881 );
		expect( port ).toBeLessThan( 9981 );
	} );

	it( 'falls back to 8881 when STUDIO_BASE_PORT is zero', async () => {
		process.env.STUDIO_BASE_PORT = '0';
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );
		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThanOrEqual( 8881 );
		expect( port ).toBeLessThan( 9981 );
	} );
} );

function listenOn( port: number, host: string ): Promise< net.Server > {
	return new Promise( ( resolve, reject ) => {
		const server = net.createServer();
		server.once( 'error', reject );
		server.listen( port, host, () => resolve( server ) );
	} );
}

function serveOn( port: number, host: string, body: string ): Promise< http.Server > {
	return new Promise( ( resolve, reject ) => {
		const server = http.createServer( ( _request, response ) => response.end( body ) );
		server.once( 'error', reject );
		server.listen( port, host, () => resolve( server ) );
	} );
}

async function supportsIpv6Loopback(): Promise< boolean > {
	try {
		const server = await listenOn( 0, '::1' );
		await new Promise< void >( ( resolve ) => server.close( () => resolve() ) );
		return true;
	} catch {
		return false;
	}
}

describe( 'portFinder availability detection', () => {
	const openServers: net.Server[] = [];

	afterEach( async () => {
		await Promise.all(
			openServers
				.splice( 0 )
				.map( ( server ) => new Promise< void >( ( resolve ) => server.close( () => resolve() ) ) )
		);
		delete process.env.STUDIO_BASE_PORT;
		vi.resetModules();
	} );

	it( 'skips a port occupied on IPv4', async () => {
		// Occupy an OS-assigned free port so the test never collides with a port
		// already in use on the machine.
		const occupiedServer = await listenOn( 0, '127.0.0.1' );
		openServers.push( occupiedServer );
		const occupied = ( occupiedServer.address() as net.AddressInfo ).port;

		process.env.STUDIO_BASE_PORT = String( occupied );
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );

		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThan( occupied );
		// Binding throws if getOpenPort handed back an occupied port.
		openServers.push( await listenOn( port, '127.0.0.1' ) );
	} );

	it( 'skips a port occupied on IPv6', async () => {
		if ( ! ( await supportsIpv6Loopback() ) ) {
			return;
		}

		const occupiedServer = await listenOn( 0, '::1' );
		openServers.push( occupiedServer );
		const occupied = ( occupiedServer.address() as net.AddressInfo ).port;

		process.env.STUDIO_BASE_PORT = String( occupied );
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );

		expect( await portFinder.getOpenPort() ).toBeGreaterThan( occupied );
	} );

	it( 'returns a port available to both localhost loopback families', async () => {
		const baseServer = await listenOn( 0, '127.0.0.1' );
		const basePort = ( baseServer.address() as net.AddressInfo ).port;
		await new Promise< void >( ( resolve ) => baseServer.close( () => resolve() ) );

		process.env.STUDIO_BASE_PORT = String( basePort );
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );
		const port = await portFinder.getOpenPort();

		openServers.push( await listenOn( port, '127.0.0.1' ) );
		if ( await supportsIpv6Loopback() ) {
			openServers.push( await listenOn( port, '::1' ) );
		}
	} );

	it( 'keeps the advertised localhost URL away from a foreign IPv4 listener', async () => {
		const foreignServer = await serveOn( 0, '127.0.0.1', 'foreign' );
		openServers.push( foreignServer );
		const foreignPort = ( foreignServer.address() as net.AddressInfo ).port;

		process.env.STUDIO_BASE_PORT = String( foreignPort );
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );
		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThan( foreignPort );

		openServers.push( await serveOn( port, '127.0.0.1', 'owned' ) );
		if ( await supportsIpv6Loopback() ) {
			openServers.push( await serveOn( port, '::1', 'owned' ) );
		}

		expect(
			await fetch( `http://localhost:${ port }` ).then( ( response ) => response.text() )
		).toBe( 'owned' );
	} );
} );
