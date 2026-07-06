import { EventEmitter } from 'events';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createConnectionMock = vi.fn();
const spawnMock = vi.fn();

function frameMessage( message: unknown ) {
	const json = JSON.stringify( message );
	const body = Buffer.from( json, 'utf8' );
	const header = Buffer.allocUnsafe( 4 );
	header.writeUInt32BE( body.length, 0 );
	return Buffer.concat( [ header, body ] );
}

function createSuccessResponse(
	request: { type: string; requestId: string },
	payload: unknown = {}
) {
	return {
		type: 'result',
		originalMessageId: request.requestId,
		payload,
	};
}

function isEventsSocketPath( peer?: string ) {
	return peer?.includes( 'daemon-events.sock' ) || peer?.includes( 'studio-daemon-events.sock' );
}

vi.mock( 'net', () => {
	const mockedModule = {
		createConnection: createConnectionMock,
	};
	return {
		...mockedModule,
		default: mockedModule,
	};
} );

vi.mock( 'child_process', () => {
	const mockedModule = {
		spawn: spawnMock,
	};
	return {
		...mockedModule,
		default: mockedModule,
	};
} );

function createMockSocket(
	onWrite?: ( socket: EventEmitter, chunk: Buffer ) => void
): EventEmitter & {
	end: ReturnType< typeof vi.fn >;
	write: ( chunk: Buffer ) => void;
	destroy: ReturnType< typeof vi.fn >;
	once: EventEmitter[ 'once' ];
	on: EventEmitter[ 'on' ];
} {
	const socket = new EventEmitter() as EventEmitter & {
		end: ReturnType< typeof vi.fn >;
		write: ( chunk: Buffer ) => void;
		destroy: ReturnType< typeof vi.fn >;
		once: EventEmitter[ 'once' ];
		on: EventEmitter[ 'on' ];
	};
	socket.end = vi.fn( () => {
		setImmediate( () => socket.emit( 'close' ) );
	} );
	socket.destroy = vi.fn( () => {
		setImmediate( () => socket.emit( 'close' ) );
	} );
	socket.write = vi.fn( ( chunk: Buffer ) => {
		onWrite?.( socket, chunk );
	} );
	setImmediate( () => socket.emit( 'connect' ) );
	return socket;
}

describe( 'process manager daemon client', () => {
	let eventSocket:
		| ( EventEmitter & {
				end: ReturnType< typeof vi.fn >;
				write: ( chunk: Buffer ) => void;
				destroy: ReturnType< typeof vi.fn >;
		  } )
		| undefined;

	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();
		eventSocket = undefined;
		process.env.STUDIO_PROCESS_MANAGER_HOME = '/tmp';
		createConnectionMock.mockImplementation( ( peer?: string ) => {
			if ( isEventsSocketPath( peer ) ) {
				eventSocket = createMockSocket();
				return eventSocket;
			}

			return createMockSocket( ( socket, chunk ) => {
				const request = JSON.parse( chunk.subarray( 4 ).toString( 'utf8' ) );
				socket.emit( 'data', frameMessage( createSuccessResponse( request ) ) );
			} );
		} );
		spawnMock.mockReturnValue( { unref: vi.fn() } );
	} );

	it( 'connectToDaemon() is idempotent once connected', async () => {
		const { connectToDaemon } = await import( '../daemon-client' );

		await connectToDaemon();
		await connectToDaemon();
		await connectToDaemon();

		expect( createConnectionMock ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'connectToDaemon() auto-starts the daemon when the socket is missing', async () => {
		createConnectionMock.mockImplementationOnce( () => {
			const error = new Error( 'missing' ) as NodeJS.ErrnoException;
			error.code = 'ENOENT';
			throw error;
		} );
		createConnectionMock.mockImplementation( ( peer?: string ) => {
			if ( isEventsSocketPath( peer ) ) {
				eventSocket = createMockSocket();
				return eventSocket;
			}

			return createMockSocket( ( socket, chunk ) => {
				const request = JSON.parse( chunk.subarray( 4 ).toString( 'utf8' ) );
				socket.emit( 'data', frameMessage( createSuccessResponse( request ) ) );
			} );
		} );

		const { connectToDaemon } = await import( '../daemon-client' );
		await connectToDaemon();

		expect( spawnMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'startProcess() validates the daemon response structure', async () => {
		createConnectionMock.mockImplementation( ( peer?: string ) => {
			if ( isEventsSocketPath( peer ) ) {
				eventSocket = createMockSocket();
				return eventSocket;
			}

			return createMockSocket( ( socket, chunk ) => {
				const request = JSON.parse( chunk.subarray( 4 ).toString( 'utf8' ) );
				socket.emit( 'data', frameMessage( createSuccessResponse( request ) ) );
			} );
		} );

		const { connectToDaemon, startProcess } = await import( '../daemon-client' );
		await connectToDaemon();

		await expect( startProcess( 'app', '/path/script.js' ) ).rejects.toThrow(
			/Invalid input|process/
		);
	} );

	it( 'isProcessRunning() filters for online processes only', async () => {
		createConnectionMock.mockImplementation( ( peer?: string ) => {
			if ( isEventsSocketPath( peer ) ) {
				eventSocket = createMockSocket();
				return eventSocket;
			}

			return createMockSocket( ( socket, chunk ) => {
				const payloadText = chunk.subarray( 4 ).toString( 'utf8' );
				const request = JSON.parse( payloadText );
				const payload =
					request.type === 'list-processes'
						? {
								processes: [
									{ name: 'app', pmId: 1, status: 'stopped', pid: 1000 },
									{ name: 'app', pmId: 2, status: 'online', pid: 2000 },
								],
						  }
						: {};
				socket.emit( 'data', frameMessage( createSuccessResponse( request, payload ) ) );
			} );
		} );

		const { connectToDaemon, isProcessRunning } = await import( '../daemon-client' );
		await connectToDaemon();
		await expect( isProcessRunning( 'app' ) ).resolves.toEqual( {
			name: 'app',
			pmId: 2,
			status: 'online',
			pid: 2000,
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
	} );

	it( 'getDaemonBus() caches the bus and re-emits compatibility events', async () => {
		const { connectToDaemon, getDaemonBus } = await import( '../daemon-client' );
		await connectToDaemon();

		const bus1 = await getDaemonBus();
		const bus2 = await getDaemonBus();
		expect( bus1 ).toBe( bus2 );

		const processMessageHandler = vi.fn();
		bus1.on( 'process-message', processMessageHandler );
		( bus1 as unknown as { handlePacket: ( packet: unknown ) => void } ).handlePacket( {
			type: 'process-message',
			payload: {
				process: { name: 'studio-site-test', pm_id: 5 },
				raw: { topic: 'ready' },
			},
		} );

		expect( processMessageHandler ).toHaveBeenCalledWith(
			expect.objectContaining( {
				process: expect.objectContaining( { name: 'studio-site-test', pm_id: 5 } ),
				raw: expect.objectContaining( { topic: 'ready' } ),
			} )
		);
	} );

	it( 'sendMessageToProcess() forwards the message through the daemon request channel', async () => {
		const writeSpy = vi.fn();
		createConnectionMock.mockImplementation( ( peer?: string ) => {
			if ( isEventsSocketPath( peer ) ) {
				eventSocket = createMockSocket();
				return eventSocket;
			}

			return createMockSocket( ( socket, chunk ) => {
				writeSpy( chunk );
				const request = JSON.parse( chunk.subarray( 4 ).toString( 'utf8' ) );
				socket.emit( 'data', frameMessage( createSuccessResponse( request ) ) );
			} );
		} );

		const { connectToDaemon, sendMessageToProcess } = await import( '../daemon-client' );
		await connectToDaemon();

		await sendMessageToProcess( 42, {
			topic: 'stop-server',
			messageId: '1',
			data: {},
		} );

		expect( writeSpy ).toHaveBeenCalled();
		const encodedRequest = writeSpy.mock.calls.at( -1 )?.[ 0 ] as Buffer;
		expect( JSON.parse( encodedRequest.subarray( 4 ).toString( 'utf8' ) ) ).toEqual(
			expect.objectContaining( {
				type: 'send-message-to-process',
				processId: 42,
				message: {
					topic: 'stop-server',
					messageId: '1',
					data: {},
				},
			} )
		);
	} );
} );
