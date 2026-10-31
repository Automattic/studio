import net from 'net';
import { isPortListening, PortWaitAbortedError, waitForPortListening } from 'cli/lib/frontend/port';

function listen( host: string ): Promise< net.Server > {
	return new Promise( ( resolve, reject ) => {
		const server = net.createServer();
		server.once( 'error', reject );
		server.listen( 0, host, () => resolve( server ) );
	} );
}

function getPort( server: net.Server ): number {
	return ( server.address() as net.AddressInfo ).port;
}

function close( server: net.Server ): Promise< void > {
	return new Promise( ( resolve ) => server.close( () => resolve() ) );
}

describe( 'frontend port readiness', () => {
	it( 'detects a listening port and a free one', async () => {
		const server = await listen( '127.0.0.1' );
		const port = getPort( server );
		expect( await isPortListening( port ) ).toBe( true );
		await close( server );
		expect( await isPortListening( port ) ).toBe( false );
	} );

	it( 'waits until the port starts listening', async () => {
		const probe = await listen( '127.0.0.1' );
		const port = getPort( probe );
		await close( probe );

		let server: net.Server | undefined;
		setTimeout( () => {
			server = net.createServer().listen( port, '127.0.0.1' );
		}, 150 );

		await expect(
			waitForPortListening( port, { timeoutMs: 5_000, intervalMs: 50 } )
		).resolves.toBeUndefined();
		if ( server ) {
			await close( server );
		}
	} );

	it( 'times out when nothing listens', async () => {
		const probe = await listen( '127.0.0.1' );
		const port = getPort( probe );
		await close( probe );

		await expect(
			waitForPortListening( port, { timeoutMs: 200, intervalMs: 50 } )
		).rejects.toThrow( /Timed out/ );
	} );

	it( 'stops waiting once aborted', async () => {
		const probe = await listen( '127.0.0.1' );
		const port = getPort( probe );
		await close( probe );

		await expect(
			waitForPortListening( port, { timeoutMs: 5_000, intervalMs: 50, isAborted: () => true } )
		).rejects.toBeInstanceOf( PortWaitAbortedError );
	} );
} );
