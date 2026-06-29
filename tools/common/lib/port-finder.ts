import http from 'http';
import net from 'net';

const basePortOverride = Number( process.env.STUDIO_BASE_PORT );
const DEFAULT_PORT =
	Number.isInteger( basePortOverride ) && basePortOverride > 0 ? basePortOverride : 8881;

let searchPort = DEFAULT_PORT;
let openPort: number | null = null;
const unavailablePorts: Array< number > = [];

function isPortFree( portToCheck: number ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		// First try to connect to the port
		const socket = new net.Socket();
		socket.on( 'error', () => {
			// If we can't connect, try to bind to the port
			const server = http.createServer();
			server
				.listen( portToCheck, () => {
					server.close();
					setTimeout( () => {
						resolve( true );
					}, 50 ); // Add a small delay to ensure port is released
				} )
				.on( 'error', () => {
					resolve( false );
				} );
		} );

		// Try to connect to the port
		socket.connect( portToCheck, 'localhost', () => {
			socket.destroy();
			resolve( false );
		} );
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
