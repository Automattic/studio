import net from 'net';

const basePortOverride = Number( process.env.STUDIO_BASE_PORT );
const DEFAULT_PORT =
	Number.isInteger( basePortOverride ) && basePortOverride > 0 ? basePortOverride : 8881;

let searchPort = DEFAULT_PORT;
let openPort: number | null = null;
const unavailablePorts: Array< number > = [];

// Browsers can resolve localhost to either loopback family. Probe both so another
// server cannot serve a different site at the same localhost URL. Bind/close
// probes avoid the connect/destroy socket churn that crashed Node on Windows.
function isHostPortFree( portToCheck: number, host: string ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const server = net.createServer();
		server.once( 'error', ( error: NodeJS.ErrnoException ) =>
			resolve( host === '::1' && [ 'EAFNOSUPPORT', 'EADDRNOTAVAIL' ].includes( error.code ?? '' ) )
		);
		server.listen( portToCheck, host, () => server.close( () => resolve( true ) ) );
	} );
}

async function isPortFree( portToCheck: number ): Promise< boolean > {
	for ( const host of [ 'localhost', '127.0.0.1', '::1' ] ) {
		if ( ! ( await isHostPortFree( portToCheck, host ) ) ) {
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
