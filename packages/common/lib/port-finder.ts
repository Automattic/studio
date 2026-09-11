import net from 'net';

const basePortOverride = Number( process.env.STUDIO_BASE_PORT );
const DEFAULT_PORT =
	Number.isInteger( basePortOverride ) && basePortOverride > 0 ? basePortOverride : 8881;

let searchPort = DEFAULT_PORT;
let openPort: number | null = null;
const unavailablePorts: Array< number > = [];

function canBind( port: number, host: string ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const server = net.createServer();
		server.once( 'error', () => resolve( false ) );
		server.listen( port, host, () => server.close( () => resolve( true ) ) );
	} );
}

let ipv6LoopbackSupported: Promise< boolean > | undefined;

function supportsIpv6Loopback(): Promise< boolean > {
	ipv6LoopbackSupported ??= canBind( 0, '::1' );
	return ipv6LoopbackSupported;
}

async function isPortFree( portToCheck: number ): Promise< boolean > {
	// Studio advertises localhost, so every supported loopback family must be free.
	if ( ! ( await canBind( portToCheck, '127.0.0.1' ) ) ) {
		return false;
	}

	return ! ( await supportsIpv6Loopback() ) || canBind( portToCheck, '::1' );
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
