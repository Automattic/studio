import net from 'net';

const basePortOverride = Number( process.env.STUDIO_BASE_PORT );
const DEFAULT_PORT =
	Number.isInteger( basePortOverride ) && basePortOverride > 0 ? basePortOverride : 8881;

let searchPort = DEFAULT_PORT;
let openPort: number | null = null;
const unavailablePorts: Array< number > = [];

// Bind the same host the site server uses (localhost, see php-server-child.ts)
// so a successful probe means the server can bind the port too; probing a fixed
// 127.0.0.1 could disagree with the server when localhost resolves to ::1. A
// single bind also avoids the connect/destroy socket churn that crashed Node on
// Windows.
function isPortFree( portToCheck: number ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const server = net.createServer();
		server.once( 'error', () => resolve( false ) );
		server.listen( portToCheck, 'localhost', () => server.close( () => resolve( true ) ) );
	} );
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
