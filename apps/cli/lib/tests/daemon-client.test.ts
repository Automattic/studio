import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createConnectionMock = vi.fn();
const spawnMock = vi.fn();
const readConfigMock = vi.fn();
const CLI_VERSION = '2.3.0';

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
		payload: request.type === 'ping' ? { version: CLI_VERSION } : payload,
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

vi.mock( '@studio/common/lib/config/store', () => ( { readConfig: readConfigMock } ) );

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
		vi.stubGlobal( '__STUDIO_CLI_VERSION__', CLI_VERSION );
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

	it.skipIf( process.platform === 'win32' )(
		'emitCliEvent() sends each event to every Studio app and live studio mcp process',
		async () => {
			const home = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pm-' ) );
			process.env.STUDIO_PROCESS_MANAGER_HOME = home;
			const live = path.join( home, `events-mcp-${ process.pid }.sock` );
			const dead = path.join( home, 'events-mcp-2147483646.sock' );
			fs.writeFileSync( live, '' );
			fs.writeFileSync( dead, '' );
			const { emitCliEvent, EVENTS_SOCKET_PATHS } = await import( '../daemon-client' );

			await emitCliEvent( { event: 'auth-logout', data: {} } as never );

			expect( createConnectionMock.mock.calls.map( ( [ peer ] ) => peer ) ).toEqual( [
				...Object.values( EVENTS_SOCKET_PATHS ),
				live,
			] );
			expect( fs.existsSync( dead ) ).toBe( false );
			fs.rmSync( home, { recursive: true, force: true } );
		}
	);

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

	it( 'startProcess() tells older daemons the site runs native PHP', async () => {
		const requests: Array< Record< string, unknown > > = [];
		createConnectionMock.mockImplementation( ( peer?: string ) => {
			if ( isEventsSocketPath( peer ) ) {
				eventSocket = createMockSocket();
				return eventSocket;
			}

			return createMockSocket( ( socket, chunk ) => {
				const request = JSON.parse( chunk.subarray( 4 ).toString( 'utf8' ) );
				requests.push( request );
				const payload =
					request.type === 'start-process'
						? { process: { name: 'app', pmId: 1, status: 'online', pid: 1000 } }
						: {};
				socket.emit( 'data', frameMessage( createSuccessResponse( request, payload ) ) );
			} );
		} );

		const { connectToDaemon, startProcess } = await import( '../daemon-client' );
		await connectToDaemon();
		await startProcess( 'app', '/path/script.js' );

		expect( requests.find( ( request ) => request.type === 'start-process' ) ).toMatchObject( {
			processName: 'app',
			scriptPath: '/path/script.js',
			runtime: 'native-php',
		} );
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

describe( 'isDaemonOutdated()', () => {
	it.each( [
		[ 'an unversioned daemon', undefined, '2.3.0', true ],
		[ 'an older daemon', '2.2.0', '2.3.0', true ],
		[ 'a daemon of the same version', '2.3.0', '2.3.0', false ],
		[ 'a newer daemon', '2.4.0', '2.3.0', false ],
		[ 'any daemon, from a client without a release version', undefined, 'dev', false ],
	] )( 'replacing %s: %s → %s is %s', async ( _label, daemonVersion, clientVersion, expected ) => {
		const { isDaemonOutdated } = await import( '../daemon-client' );
		expect( isDaemonOutdated( daemonVersion, clientVersion ) ).toBe( expected );
	} );
} );

describe( 'replacing an outdated daemon', () => {
	let home: string;
	let daemon: { running: boolean; version?: string; processes: unknown[] };
	let requests: string[];
	let siteStarts: string[];

	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.stubGlobal( '__STUDIO_CLI_VERSION__', CLI_VERSION );
		home = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pm-' ) );
		process.env.STUDIO_PROCESS_MANAGER_HOME = home;
		requests = [];
		siteStarts = [];
		daemon = {
			running: true,
			processes: [
				{ name: 'studio-site-a', pmId: 1, status: 'online', pid: 101 },
				{ name: 'studio-site-b', pmId: 2, status: 'online', pid: 102 },
			],
		};
		readConfigMock.mockResolvedValue( {
			sites: [ 'a', 'b', 'c' ].map( ( id ) => {
				fs.mkdirSync( path.join( home, id ) );
				return { id, name: id, path: path.join( home, id ) };
			} ),
		} );

		createConnectionMock.mockImplementation( ( peer?: string ) => {
			if ( isEventsSocketPath( peer ) ) {
				return createMockSocket();
			}
			if ( ! daemon.running ) {
				const error = new Error( 'refused' ) as NodeJS.ErrnoException;
				error.code = 'ECONNREFUSED';
				throw error;
			}
			return createMockSocket( ( socket, chunk ) => {
				const request = JSON.parse( chunk.subarray( 4 ).toString( 'utf8' ) );
				requests.push( request.type );
				const payloads: Record< string, unknown > = {
					ping: daemon.version ? { version: daemon.version } : {},
					'list-processes': { processes: daemon.processes },
				};
				socket.emit(
					'data',
					frameMessage( {
						type: 'result',
						originalMessageId: request.requestId,
						payload: payloads[ request.type ] ?? {},
					} )
				);
				if ( request.type === 'kill-daemon' ) {
					daemon.running = false;
				}
			} );
		} );

		spawnMock.mockImplementation( ( _execPath: string, args: string[] ) => {
			if ( args[ 0 ].endsWith( 'process-manager-daemon.mjs' ) ) {
				Object.assign( daemon, { running: true, version: CLI_VERSION, processes: [] } );
				return { unref: vi.fn() };
			}
			siteStarts.push( args[ args.indexOf( '--path' ) + 1 ] );
			const child = new EventEmitter();
			setImmediate( () => child.emit( 'exit', 0 ) );
			return child;
		} );

		return () => fs.rmSync( home, { recursive: true, force: true } );
	} );

	it( 'replaces a daemon without a version and starts its sites again with this CLI', async () => {
		const { connectToDaemon } = await import( '../daemon-client' );
		await connectToDaemon();

		expect( requests ).toContain( 'kill-daemon' );
		expect( daemon.version ).toBe( CLI_VERSION );
		expect( siteStarts.sort() ).toEqual( [ path.join( home, 'a' ), path.join( home, 'b' ) ] );
	} );

	it( 'starts the sites a client exited before starting again', async () => {
		daemon.version = CLI_VERSION;
		fs.writeFileSync(
			path.join( home, 'sites-to-restart.json' ),
			JSON.stringify( { pid: 2147483646, processNames: [ 'studio-site-a' ] } )
		);
		const { connectToDaemon } = await import( '../daemon-client' );
		await connectToDaemon();

		expect( siteStarts ).toEqual( [ path.join( home, 'a' ) ] );
		expect( fs.existsSync( path.join( home, 'sites-to-restart.json' ) ) ).toBe( false );
	} );

	it( 'reports only the sites no other process is starting when a start fails', async () => {
		const { sites } = await readConfigMock();
		sites[ 0 ].operation = { pid: process.ppid, kind: 'start' };
		spawnMock.mockImplementation( ( _execPath: string, args: string[] ) => {
			if ( args[ 0 ].endsWith( 'process-manager-daemon.mjs' ) ) {
				Object.assign( daemon, { running: true, version: CLI_VERSION, processes: [] } );
				return { unref: vi.fn() };
			}
			const child = new EventEmitter();
			setImmediate( () => child.emit( 'exit', 1 ) );
			return child;
		} );
		const consoleError = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const { connectToDaemon } = await import( '../daemon-client' );
		await connectToDaemon();

		expect( consoleError ).toHaveBeenCalledTimes( 1 );
		expect( consoleError ).toHaveBeenCalledWith( expect.stringContaining( '"b"' ) );
	} );

	it( 'keeps a newer daemon and its sites', async () => {
		daemon.version = '9.0.0';
		const { connectToDaemon } = await import( '../daemon-client' );
		await connectToDaemon();

		expect( requests ).not.toContain( 'kill-daemon' );
		expect( spawnMock ).not.toHaveBeenCalled();
	} );

	it( 'replaces the daemon once when clients connect at the same time', async () => {
		// The real lockfile is what serializes clients.
		vi.doUnmock( 'proper-lockfile' );
		const clients = [];
		for ( let i = 0; i < 3; i++ ) {
			vi.resetModules();
			clients.push( await import( '../daemon-client' ) );
		}

		await Promise.all( clients.map( ( client ) => client.connectToDaemon() ) );

		expect( requests.filter( ( type ) => type === 'kill-daemon' ) ).toHaveLength( 1 );
		expect( siteStarts.sort() ).toEqual( [ path.join( home, 'a' ), path.join( home, 'b' ) ] );
	} );
} );
