import net from 'net';
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

function listenOnLoopback( port: number ): Promise< net.Server > {
	return new Promise( ( resolve, reject ) => {
		const server = net.createServer();
		server.once( 'error', reject );
		server.listen( port, '127.0.0.1', () => resolve( server ) );
	} );
}

describe( 'portFinder availability detection', () => {
	afterEach( () => {
		delete process.env.STUDIO_BASE_PORT;
		vi.resetModules();
	} );

	it( 'skips an occupied port and returns one that is actually bindable', async () => {
		const occupied = 9320;
		const occupiedServer = await listenOnLoopback( occupied );

		process.env.STUDIO_BASE_PORT = String( occupied );
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );

		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThan( occupied );
		// Binding throws if getOpenPort handed back an occupied port.
		const returnedServer = await listenOnLoopback( port );

		occupiedServer.close();
		returnedServer.close();
	} );
} );
