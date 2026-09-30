import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { connectToEndpoint, SocketMessageDecoder, SocketServer } from 'cli/lib/socket';

const CONNECT_TIMEOUT_MS = 2500;
const RETRY_DELAY_MS = 250;

/**
 * Receives every event published to `endpoint`, alongside any other process doing the same. The
 * first to bind the socket is the hub and rebroadcasts each event to the rest, which follow it and
 * race to take over when it exits. That lets the Desktop app and the `studio ui` server each run
 * their own `_events` while CLI commands keep publishing to a single socket.
 *
 * Resolves once joined, with a function that leaves the hub.
 */
export async function joinEventHub(
	endpoint: string,
	onEvent: ( message: unknown ) => void
): Promise< () => Promise< void > > {
	let left = false;
	let leave = async () => {};

	const join = async (): Promise< void > => {
		while ( ! left ) {
			const server = new SocketServer( endpoint, CONNECT_TIMEOUT_MS );
			try {
				await server.listen();
				server.on( 'message', ( { message, socket } ) => {
					onEvent( message );
					server.broadcast( message, socket );
				} );
				leave = () => server.close();
				return;
			} catch ( error ) {
				if ( ! isErrnoException( error ) || error.code !== 'EADDRINUSE' ) {
					throw error;
				}
			}

			try {
				const socket = await connectToEndpoint( endpoint, CONNECT_TIMEOUT_MS );
				let decoder = new SocketMessageDecoder();
				socket.on( 'data', ( chunk ) => {
					let messages: unknown[];
					try {
						messages = decoder.write( chunk );
					} catch {
						decoder = new SocketMessageDecoder();
						return;
					}
					for ( const message of messages ) {
						onEvent( message );
					}
				} );
				socket.on( 'error', () => {} );
				socket.once( 'close', () => {
					join().catch( ( error ) => console.error( 'Failed to rejoin the events hub', error ) );
				} );
				leave = async () => void socket.destroy();
				return;
			} catch {
				// The hub went away between our bind and connect attempts.
				await new Promise( ( resolve ) => setTimeout( resolve, RETRY_DELAY_MS ) );
			}
		}
	};

	await join();
	return async () => {
		left = true;
		await leave();
	};
}
