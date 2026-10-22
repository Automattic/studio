import net from 'node:net';

function listenOnFreePort( server: net.Server ): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			const address = server.address();
			if ( ! address || typeof address === 'string' ) {
				reject( new Error( 'Could not allocate a PHP worker port' ) );
				return;
			}
			resolve( address.port );
		} );
	} );
}

/**
 * Returns `count` distinct free ports for the PHP workers. Each probe server stays
 * bound until every port is chosen, so the OS cannot hand a port it just released
 * to the next probe.
 */
export async function getAvailablePorts( count: number ): Promise< number[] > {
	const servers: net.Server[] = [];
	try {
		const ports: number[] = [];
		for ( let index = 0; index < count; index++ ) {
			const server = net.createServer();
			server.unref();
			servers.push( server );
			ports.push( await listenOnFreePort( server ) );
		}
		return ports;
	} finally {
		await Promise.all(
			servers.map(
				( server ) =>
					new Promise< void >( ( resolve ) => {
						if ( ! server.listening ) {
							resolve();
							return;
						}
						server.close( () => resolve() );
					} )
			)
		);
	}
}
