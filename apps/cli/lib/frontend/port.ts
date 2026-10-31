import net from 'net';

// Dev servers bind `localhost`, which resolves to ::1 first on recent Node, or
// 127.0.0.1, or both; either one answering means the frontend URL works.
const LOOPBACK_HOSTS = [ '127.0.0.1', '::1' ];
const CONNECT_TIMEOUT_MS = 1_000;
const POLL_INTERVAL_MS = 250;

function canConnect( port: number, host: string ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const socket = net.connect( { port, host } );
		const finish = ( result: boolean ) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve( result );
		};
		socket.setTimeout( CONNECT_TIMEOUT_MS, () => finish( false ) );
		socket.once( 'connect', () => finish( true ) );
		socket.once( 'error', () => finish( false ) );
	} );
}

export async function isPortListening( port: number ): Promise< boolean > {
	const results = await Promise.all( LOOPBACK_HOSTS.map( ( host ) => canConnect( port, host ) ) );
	return results.some( Boolean );
}

export class PortWaitAbortedError extends Error {}

/**
 * Resolves once something accepts connections on `port`. Rejects after
 * `timeoutMs`, or as soon as `isAborted` returns true (the process meant to
 * listen there has exited).
 */
export async function waitForPortListening(
	port: number,
	options: { timeoutMs: number; isAborted?: () => boolean; intervalMs?: number }
): Promise< void > {
	const deadline = Date.now() + options.timeoutMs;
	const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
	for (;;) {
		if ( options.isAborted?.() ) {
			throw new PortWaitAbortedError( `Stopped waiting for port ${ port }` );
		}
		if ( await isPortListening( port ) ) {
			return;
		}
		if ( Date.now() >= deadline ) {
			throw new Error(
				`Timed out after ${ Math.round( options.timeoutMs / 1000 ) }s waiting for port ${ port }`
			);
		}
		await new Promise( ( resolve ) => setTimeout( resolve, intervalMs ) );
	}
}
