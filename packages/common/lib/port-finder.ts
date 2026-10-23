import net from 'net';

const basePortOverride = Number( process.env.STUDIO_BASE_PORT );
const DEFAULT_PORT =
	Number.isInteger( basePortOverride ) && basePortOverride > 0 ? basePortOverride : 8881;

let searchPort = DEFAULT_PORT;
let openPort: number | null = null;
const unavailablePorts: Array< number > = [];

// Another app holding the port on any local address takes some of the site's requests.
// Binds, not connects: connect/destroy socket churn crashed Node on Windows.
const LOCAL_ADDRESSES = [ '::', '0.0.0.0', '::1', '127.0.0.1' ];

function canBind( port: number, host: string ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const server = net.createServer();
		// An address the machine lacks (IPv6 turned off) can't hold the port.
		server.once( 'error', ( error: NodeJS.ErrnoException ) =>
			resolve( error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT' )
		);
		server.listen( port, host, () => server.close( () => resolve( true ) ) );
	} );
}

async function isPortFree( portToCheck: number ): Promise< boolean > {
	for ( const host of LOCAL_ADDRESSES ) {
		if ( ! ( await canBind( portToCheck, host ) ) ) {
			return false;
		}
	}
	return true;
}

function addUnavailablePort( port?: number ): void {
	if ( port && ! unavailablePorts.includes( port ) ) {
		unavailablePorts.push( port );
	}
}

/**
 * Returns the first available open port, caching and reusing it for subsequent calls.
 */
async function getOpenPort( portToStart?: number ): Promise< number > {
	searchPort = portToStart ? portToStart : openPort ?? DEFAULT_PORT;

	if ( portToStart && ( await isPortFree( searchPort ) ) ) {
		const port = searchPort;
		openPort = ++searchPort;
		return port;
	}
	let isPortUnavailable = unavailablePorts.includes( searchPort );

	while ( isPortUnavailable || ! ( await isPortFree( searchPort ) ) ) {
		++searchPort;
		isPortUnavailable = unavailablePorts.includes( searchPort );
	}

	const port = searchPort;
	addUnavailablePort( port );
	openPort = ++searchPort;
	return port;
}

export const portFinder = {
	getOpenPort,
	addUnavailablePort,
};
