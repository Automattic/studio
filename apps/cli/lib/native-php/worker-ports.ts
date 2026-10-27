import net from 'node:net';

// Returns `count` distinct free ports for the PHP workers. Every probe stays bound until all the
// ports are chosen, so the OS can't hand a port that was just released to the next probe.
export async function getAvailablePorts( count: number ): Promise< number[] > {
	const servers: net.Server[] = [];
	try {
		for ( let index = 0; index < count; index++ ) {
			const server = net.createServer().unref();
			servers.push( server );
			await new Promise< void >( ( resolve, reject ) => {
				server.once( 'error', reject );
				server.listen( 0, '127.0.0.1', resolve );
			} );
		}
		return servers.map( ( server ) => ( server.address() as net.AddressInfo ).port );
	} finally {
		await Promise.all(
			servers.map( ( server ) => new Promise( ( resolve ) => server.close( resolve ) ) )
		);
	}
}
