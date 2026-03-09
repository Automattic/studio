import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';

const DEFAULT_CONNECT_TIMEOUT_MS = 500;

function isWindowsNamedPipe( endpoint: string ): boolean {
	return endpoint.startsWith( '\\\\.\\pipe\\' );
}

function isUnixSocketPath( endpoint: string ): boolean {
	return ! isWindowsNamedPipe( endpoint );
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

export class SocketClient {
	private readonly peer: string;
	private readonly connectTimeoutMs: number;
	private queue = Promise.resolve();

	constructor( peer: string, connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS ) {
		this.peer = peer;
		this.connectTimeoutMs = connectTimeoutMs;
	}

	send( message: unknown ): Promise< void > {
		const payload = this.encodeSocketMessage( message );
		const sendPromise = this.queue.then( async () => {
			const socket = await this.connect();
			await this.sendToSocket( socket, payload );
		} );
		this.queue = sendPromise.catch( () => undefined );
		return sendPromise;
	}

	async connect(): Promise< net.Socket > {
		let timeoutId: NodeJS.Timeout;
		const socket = net.createConnection( this.peer );

		return new Promise< net.Socket >( ( resolve, reject ) => {
			timeoutId = setTimeout( () => {
				socket.destroy();
				reject( new Error( `Socket connect timeout: ${ this.peer }` ) );
			}, this.connectTimeoutMs );

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

	encodeSocketMessage( message: unknown ): Buffer {
		const json = JSON.stringify( message );
		const body = Buffer.from( json, 'utf8' );
		const header = Buffer.allocUnsafe( 4 );
		header.writeUInt32BE( body.length, 0 );
		return Buffer.concat( [ header, body ] );
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
				reject( new Error( `Socket closed before send: ${ this.peer }` ) );
				return;
			}
			socket.end( payload );
		} ).finally( () => {
			socket.removeAllListeners();
		} );
	}
}

export class SocketServer extends EventEmitter {
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
						this.emit( 'message', message );
					}
				} catch ( error ) {
					this.emit( 'message-error', error );
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
		const socketClient = new SocketClient( this.endpoint, timeoutMs );
		try {
			const socket = await socketClient.connect();
			socket.destroy();
			return true;
		} catch {
			return false;
		}
	}

	close(): Promise< void > {
		return new Promise< void >( ( resolve ) => {
			for ( const socket of this.sockets ) {
				socket.destroy();
			}

			if ( ! this.server.listening ) {
				resolve();
				return;
			}

			this.server.close( () => {
				resolve();
			} );
		} );
	}
}
