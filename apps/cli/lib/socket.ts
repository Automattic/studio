import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { DaemonResponse } from 'cli/lib/types/process-manager-ipc';

const DEFAULT_CONNECT_TIMEOUT_MS = 500;
const DEFAULT_RECONNECT_DELAY_MS = 500;
// How long a request-response client waits for the peer to answer once connected. Without
// this bound, a wedged daemon that accepts connections but never replies hangs the caller
// forever (observed as `site stop --all` never exiting on Windows CI).
const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000;
// How long to wait for a socket's pending writes to flush during graceful close before
// giving up and forcefully destroying it.
const GRACEFUL_SOCKET_END_TIMEOUT_MS = 500;

function isWindowsNamedPipe( endpoint: string ): boolean {
	return endpoint.startsWith( '\\\\.\\pipe\\' );
}

function isUnixSocketPath( endpoint: string ): boolean {
	return ! isWindowsNamedPipe( endpoint );
}

function encodeSocketMessage( message: unknown ): Buffer {
	const json = JSON.stringify( message );
	const body = Buffer.from( json, 'utf8' );
	const header = Buffer.allocUnsafe( 4 );
	header.writeUInt32BE( body.length, 0 );
	return Buffer.concat( [ header, body ] );
}

// TCP gives us arbitrary byte chunks, not one object per `data` event.
// This buffers bytes and reconstructs our wire format:
// [4-byte big-endian JSON length][JSON payload].
export class SocketMessageDecoder {
	private buffer = Buffer.alloc( 0 );

	write( chunk: Buffer ): unknown[] {
		this.buffer = Buffer.concat( [ this.buffer, chunk ] );
		const messages: unknown[] = [];

		while ( this.buffer.length >= 4 ) {
			const length = this.buffer.readUInt32BE( 0 );
			if ( this.buffer.length < 4 + length ) {
				break;
			}

			const payload = this.buffer.subarray( 4, 4 + length );
			this.buffer = this.buffer.subarray( 4 + length );
			messages.push( JSON.parse( payload.toString( 'utf8' ) ) );
		}

		return messages;
	}
}

async function connectToEndpoint( peer: string, connectTimeoutMs: number ): Promise< net.Socket > {
	let timeoutId: NodeJS.Timeout;
	const socket = net.createConnection( peer );

	return new Promise< net.Socket >( ( resolve, reject ) => {
		timeoutId = setTimeout( () => {
			socket.destroy();
			reject( new Error( `Socket connect timeout: ${ peer }` ) );
		}, connectTimeoutMs );

		socket.once( 'connect', () => {
			resolve( socket );
		} );
		socket.once( 'error', ( error ) => {
			reject( error );
		} );
	} ).finally( () => {
		clearTimeout( timeoutId );
		socket.removeAllListeners();
	} );
}

type SocketClientEventMap = {
	connect: { socket: net.Socket };
	data: { chunk: Buffer; socket: net.Socket };
	error: { error: Error };
	close: { hadError: boolean };
	reconnecting: { delayMs: number };
};

class SocketClientEventEmitter extends EventEmitter {
	on< K extends keyof SocketClientEventMap >(
		event: K,
		listener: ( payload: SocketClientEventMap[ K ] ) => void
	): this {
		return super.on( event, listener );
	}

	emit< K extends keyof SocketClientEventMap >(
		event: K,
		payload: SocketClientEventMap[ K ]
	): boolean {
		return super.emit( event, payload );
	}
}

export class SocketStreamClient extends SocketClientEventEmitter {
	private readonly endpoint: string;
	private readonly connectTimeoutMs: number;
	private readonly reconnectDelayMs: number;
	private socket: net.Socket | null = null;
	private connectPromise: Promise< net.Socket > | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private closedByClient = false;

	constructor( endpoint: string, connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS ) {
		super();
		this.endpoint = endpoint;
		this.connectTimeoutMs = connectTimeoutMs;
		this.reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS;
	}

	async connect(): Promise< net.Socket > {
		this.closedByClient = false;
		if ( this.isConnected() ) {
			return this.socket as net.Socket;
		}

		if ( this.connectPromise ) {
			return this.connectPromise;
		}

		this.connectPromise = connectToEndpoint( this.endpoint, this.connectTimeoutMs )
			.then( ( socket ) => {
				this.attachPersistentSocketListeners( socket );
				this.emit( 'connect', { socket } );
				return socket;
			} )
			.finally( () => {
				this.connectPromise = null;
			} );

		return this.connectPromise;
	}

	isConnected(): boolean {
		return this.socket !== null && ! this.socket.destroyed;
	}

	async close(): Promise< void > {
		this.closedByClient = true;
		if ( this.reconnectTimer ) {
			clearTimeout( this.reconnectTimer );
			this.reconnectTimer = null;
		}

		const socket = this.socket;
		this.socket = null;
		if ( socket && ! socket.destroyed ) {
			await new Promise< void >( ( resolve ) => {
				socket.once( 'close', () => resolve() );
				socket.end();
			} );
		}
	}

	private scheduleReconnect() {
		if ( this.closedByClient || this.reconnectTimer ) {
			return;
		}

		this.emit( 'reconnecting', { delayMs: this.reconnectDelayMs } );
		this.reconnectTimer = setTimeout( () => {
			this.reconnectTimer = null;
			void this.connect().catch( () => {
				this.scheduleReconnect();
			} );
		}, this.reconnectDelayMs );
	}

	private attachPersistentSocketListeners( socket: net.Socket ) {
		this.socket = socket;
		socket.on( 'data', ( chunk ) => {
			this.emit( 'data', { chunk, socket } );
		} );

		socket.on( 'error', ( error ) => {
			this.emit( 'error', { error } );
		} );

		socket.on( 'close', ( hadError ) => {
			if ( this.socket === socket ) {
				this.socket = null;
			}

			this.emit( 'close', { hadError } );
			this.scheduleReconnect();
		} );
	}
}

export class SocketRequestClient {
	private readonly endpoint: string;
	private readonly connectTimeoutMs: number;
	private readonly responseTimeoutMs: number;
	private queue = Promise.resolve();

	constructor(
		endpoint: string,
		connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
		responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS
	) {
		this.endpoint = endpoint;
		this.connectTimeoutMs = connectTimeoutMs;
		this.responseTimeoutMs = responseTimeoutMs;
	}

	send( message: unknown ): Promise< void > {
		const payload = encodeSocketMessage( message );
		const sendPromise = this.queue.then( async () => {
			const socket = await connectToEndpoint( this.endpoint, this.connectTimeoutMs );
			await this.sendToSocket( socket, payload );
		} );
		this.queue = sendPromise.catch( () => undefined );
		return sendPromise;
	}

	private async sendToSocket( socket: net.Socket, payload: Buffer ): Promise< void > {
		return new Promise< void >( ( resolve, reject ) => {
			socket.once( 'error', ( error ) => {
				reject( error );
			} );
			socket.once( 'close', () => {
				resolve();
			} );
			if ( socket.destroyed ) {
				reject( new Error( `Socket closed before send: ${ this.endpoint }` ) );
				return;
			}
			socket.end( payload );
		} ).finally( () => {
			socket.removeAllListeners();
		} );
	}

	sendAndWaitForResponse( message: unknown ): Promise< unknown > {
		const payload = encodeSocketMessage( message );
		const responsePromise = this.queue.then( async () => {
			const socket = await connectToEndpoint( this.endpoint, this.connectTimeoutMs );
			return this.sendAndReadFromSocket( socket, payload );
		} );
		this.queue = responsePromise.then(
			() => undefined,
			() => undefined
		);
		return responsePromise;
	}

	private async sendAndReadFromSocket( socket: net.Socket, payload: Buffer ): Promise< unknown > {
		const decoder = new SocketMessageDecoder();
		let timeoutId: NodeJS.Timeout;

		return new Promise< unknown >( ( resolve, reject ) => {
			timeoutId = setTimeout( () => {
				reject( new Error( `Socket response timeout: ${ this.endpoint }` ) );
				socket.destroy();
			}, this.responseTimeoutMs );
			socket.once( 'error', ( error ) => {
				reject( error );
			} );
			socket.on( 'data', ( chunk ) => {
				try {
					for ( const message of decoder.write( chunk ) ) {
						resolve( message );
						return;
					}
				} catch ( error ) {
					reject( error );
				}
			} );
			socket.once( 'close', () => {
				reject( new Error( `Socket closed before response: ${ this.endpoint }` ) );
			} );
			if ( socket.destroyed ) {
				reject( new Error( `Socket closed before send: ${ this.endpoint }` ) );
				return;
			}
			socket.write( payload );
		} ).finally( () => {
			clearTimeout( timeoutId );
			socket.removeAllListeners();
			socket.end();
		} );
	}
}

type SocketServerEventMap = {
	message: { message: unknown; socket: net.Socket };
	'message-error': { error: unknown };
};

class SocketServerEventEmitter extends EventEmitter {
	on< K extends keyof SocketServerEventMap >(
		event: K,
		listener: ( payload: SocketServerEventMap[ K ] ) => void
	): this {
		return super.on( event, listener );
	}

	emit< K extends keyof SocketServerEventMap >(
		event: K,
		payload: SocketServerEventMap[ K ]
	): boolean {
		return super.emit( event, payload );
	}
}

export class SocketServer extends SocketServerEventEmitter {
	private readonly endpoint: string;
	private readonly sockets = new Set< net.Socket >();
	private readonly server: net.Server;
	private readonly connectTimeoutMs: number;

	constructor( endpoint: string, connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS ) {
		super();
		this.endpoint = endpoint;
		this.connectTimeoutMs = connectTimeoutMs;
		this.server = net.createServer( ( socket ) => {
			this.sockets.add( socket );
			const decoder = new SocketMessageDecoder();

			socket.on( 'data', ( chunk ) => {
				try {
					for ( const message of decoder.write( chunk ) ) {
						this.emit( 'message', { message, socket } );
					}
				} catch ( error ) {
					this.emit( 'message-error', { error } );
				}
			} );

			socket.on( 'close', () => {
				this.sockets.delete( socket );
			} );

			socket.on( 'error', () => {
				this.sockets.delete( socket );
			} );
		} );
	}

	async listen(): Promise< void > {
		try {
			await this.attemptServerListen();
		} catch ( bindError ) {
			const isRecoverableInUse =
				isErrnoException( bindError ) &&
				bindError.code === 'EADDRINUSE' &&
				isUnixSocketPath( this.endpoint );

			if ( ! isRecoverableInUse ) {
				throw bindError;
			}

			const activeServerExists = await this.canConnectUsingClient();
			if ( activeServerExists ) {
				throw bindError;
			}

			try {
				fs.unlinkSync( this.endpoint );
			} catch ( unlinkError ) {
				if ( isErrnoException( unlinkError ) && unlinkError.code !== 'ENOENT' ) {
					throw unlinkError;
				}
			}

			await this.attemptServerListen();
		}
	}

	sendAndClose( socket: net.Socket, message: DaemonResponse ) {
		socket.end( encodeSocketMessage( message ) );
	}

	send( socket: net.Socket, message: unknown ) {
		socket.write( encodeSocketMessage( message ) );
	}

	broadcast( message: unknown ) {
		const payload = encodeSocketMessage( message );

		for ( const socket of this.sockets ) {
			if ( ! socket.destroyed ) {
				socket.write( payload );
			}
		}
	}

	private async attemptServerListen(): Promise< void > {
		let timeoutId: NodeJS.Timeout;

		return new Promise< void >( ( resolve, reject ) => {
			timeoutId = setTimeout( () => {
				reject( new Error( 'Socket bind timeout' ) );
			}, this.connectTimeoutMs );

			this.server.once( 'error', ( error ) => {
				reject( error );
			} );
			this.server.once( 'listening', () => {
				resolve();
			} );
			this.server.listen( this.endpoint );
		} ).finally( () => {
			this.server.removeAllListeners( 'error' );
			this.server.removeAllListeners( 'listening' );
			clearTimeout( timeoutId );
		} );
	}

	private async canConnectUsingClient(
		timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS
	): Promise< boolean > {
		let timeoutId: NodeJS.Timeout;
		const socket = net.createConnection( this.endpoint );

		return new Promise< boolean >( ( resolve ) => {
			timeoutId = setTimeout( () => {
				socket.destroy();
				resolve( false );
			}, timeoutMs );

			socket.once( 'connect', () => {
				socket.destroy();
				resolve( true );
			} );
			socket.once( 'error', () => {
				resolve( false );
			} );
		} ).finally( () => {
			clearTimeout( timeoutId );
		} );
	}

	async close(): Promise< void > {
		// End each socket gracefully so any pending writes (e.g. an in-flight response)
		// have a chance to flush. Forcefully destroy as a fallback if the peer is slow.
		await Promise.all(
			Array.from( this.sockets ).map( ( socket ) => this.endSocketGracefully( socket ) )
		);

		if ( ! this.server.listening ) {
			return;
		}

		await new Promise< void >( ( resolve ) => {
			this.server.close( () => {
				resolve();
			} );
		} );
	}

	private endSocketGracefully( socket: net.Socket ): Promise< void > {
		return new Promise< void >( ( resolve ) => {
			if ( socket.destroyed ) {
				resolve();
				return;
			}

			const fallback = setTimeout( () => {
				socket.destroy();
			}, GRACEFUL_SOCKET_END_TIMEOUT_MS );

			socket.once( 'close', () => {
				clearTimeout( fallback );
				resolve();
			} );

			socket.end();
		} );
	}
}
