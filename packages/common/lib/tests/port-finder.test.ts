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

function listen( port: number, host: string ): Promise< net.Server > {
	return new Promise( ( resolve, reject ) => {
		const server = net.createServer();
		server.once( 'error', reject );
		server.listen( port, host, () => resolve( server ) );
	} );
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

	it.each( [ 'localhost', '127.0.0.1', '0.0.0.0', '::' ] )(
		'skips a port another app holds on %s and returns one that is actually bindable',
		async ( host ) => {
			// Occupy an OS-assigned free port so the test never collides with a port
			// already in use on the machine.
			const occupiedServer = await listen( 0, host );
			openServers.push( occupiedServer );
			const occupied = ( occupiedServer.address() as net.AddressInfo ).port;

			process.env.STUDIO_BASE_PORT = String( occupied );
			vi.resetModules();
			const { portFinder } = await import( '../port-finder' );

			const port = await portFinder.getOpenPort();
			expect( port ).toBeGreaterThan( occupied );
			// Binding throws if getOpenPort handed back an occupied port.
			openServers.push( await listen( port, 'localhost' ) );
		}
	);
} );

describe( 'isPortFree', () => {
	it.each( [ 'localhost', '127.0.0.1' ] )(
		'reports a port held on %s as taken, and free once released',
		async ( host ) => {
			const server = await listen( 0, host );
			const port = ( server.address() as net.AddressInfo ).port;
			const { isPortFree } = await import( '../port-finder' );

			expect( await isPortFree( port ) ).toBe( false );
			await new Promise< void >( ( resolve ) => server.close( () => resolve() ) );
			expect( await isPortFree( port ) ).toBe( true );
		}
	);
} );
