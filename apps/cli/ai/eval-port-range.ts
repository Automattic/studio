import net from 'node:net';

const FIRST_PORT = 20000;
const PORTS_PER_RANGE = 100;
const RANGES = 100;
// The port that holds each range, below the ranges themselves.
const FIRST_HOLD_PORT = FIRST_PORT - RANGES;

function hold( port: number ): Promise< net.Server | undefined > {
	return new Promise( ( resolve ) => {
		const server = net.createServer();
		server.once( 'error', () => resolve( undefined ) );
		server.listen( port, '127.0.0.1', () => resolve( server.unref() ) );
	} );
}

/**
 * Claims a range of ports for this process's sites and returns its first
 * port. Concurrent cases each create sites, and a case cannot see the port
 * another assigns after it looked, so each takes a range of its own. A
 * range is held by listening on a port of its own, which one process at a
 * time can do and which ends with the process.
 */
export async function claimPortRange(): Promise< number > {
	for ( let range = 0; range < RANGES; range++ ) {
		if ( await hold( FIRST_HOLD_PORT + range ) ) {
			return FIRST_PORT + range * PORTS_PER_RANGE;
		}
	}
	throw new Error( `All ${ RANGES } eval port ranges are held by running processes.` );
}
