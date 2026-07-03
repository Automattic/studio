import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { SITE_RUNTIME_NATIVE_PHP, SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testProcessName = 'studio-site-process-manager-test';
const tmpDir = path.join( os.tmpdir(), 'studio-daemon-test' );

class MockChildProcess extends EventEmitter {
	pid = 4321;
	connected = true;
	stdout = new PassThrough();
	stderr = new PassThrough();
	send = vi.fn(
		( _message: unknown, callback?: ( error: Error | null ) => void ) => callback?.( null )
	);
	kill = vi.fn( () => {
		this.connected = false;
		this.emit( 'exit', 0 );
		return true;
	} );
}

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock( 'child_process', () => {
	const mockedModule = {
		spawn: spawnMock,
		spawnSync: spawnSyncMock,
	};
	return {
		...mockedModule,
		default: mockedModule,
	};
} );

vi.mock( '../socket', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('../lib/socket') >();
	return {
		...actual,
		SocketClient: class {
			send = vi.fn().mockResolvedValue( undefined );
			connect = vi.fn().mockResolvedValue( { destroy: vi.fn() } );
		},
	};
} );

describe( 'ProcessManagerDaemon', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		fs.mkdirSync( path.join( tmpDir, 'logs' ), { recursive: true } );
		process.env.STUDIO_PROCESS_MANAGER_HOME = tmpDir;
	} );

	it( 'starts a process, emits events, and writes logs', async () => {
		const child = new MockChildProcess();
		spawnMock.mockReturnValue( child );
		const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

		const daemon = new ProcessManagerDaemon();
		const daemonInternal = daemon as unknown as {
			handleRequest: ( request: unknown ) => Promise< {
				type: string;
				payload: { process?: { pmId: number; name: string; status: string; pid?: number } };
			} >;
			broadcastEvent: ( event: unknown ) => Promise< void >;
		};
		const broadcastSpy = vi
			.spyOn( daemonInternal, 'broadcastEvent' )
			.mockResolvedValue( undefined );

		const response = await daemonInternal.handleRequest( {
			type: 'start-process',
			requestId: '1',
			processName: testProcessName,
			scriptPath: '/tmp/test-child.js',
			env: {},
			args: [],
			runtime: SITE_RUNTIME_NATIVE_PHP,
		} );

		expect( response ).toEqual(
			expect.objectContaining( {
				type: 'result',
				payload: expect.objectContaining( {
					process: expect.objectContaining( {
						name: testProcessName,
						status: 'online',
						pid: 4321,
						runtime: SITE_RUNTIME_NATIVE_PHP,
					} ),
				} ),
			} )
		);

		child.stdout.write( 'fixture-stdout\n' );
		child.stderr.write( 'fixture-stderr\n' );
		child.emit( 'message', { topic: 'ready' } );
		await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );

		expect( broadcastSpy ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'process-event',
				payload: expect.objectContaining( { event: 'online' } ),
			} )
		);
		expect( broadcastSpy ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'process-message',
				payload: expect.objectContaining( {
					process: expect.objectContaining( { name: testProcessName } ),
					raw: expect.objectContaining( { topic: 'ready' } ),
				} ),
			} )
		);

		const now = new Date();
		const dateTag = `${ now.getFullYear() }${ String( now.getMonth() + 1 ).padStart(
			2,
			'0'
		) }${ String( now.getDate() ).padStart( 2, '0' ) }`;
		// The daemon pipes child output through readline into a buffered WriteStream, so the
		// bytes reach disk several async hops after we write them. Poll until the output
		// lands; the flush can lag on slower agents (notably Windows CI).
		await vi.waitFor(
			() => {
				expect(
					fs.readFileSync(
						path.join( tmpDir, 'logs', `${ testProcessName }-out-${ dateTag }.log` ),
						'utf8'
					)
				).toContain( 'fixture-stdout' );
				expect(
					fs.readFileSync(
						path.join( tmpDir, 'logs', `${ testProcessName }-error-${ dateTag }.log` ),
						'utf8'
					)
				).toContain( 'fixture-stderr' );
			},
			{ timeout: 2000 }
		);
	} );

	it( 'includes captured stderr in the exit event payload', async () => {
		const child = new MockChildProcess();
		spawnMock.mockReturnValue( child );
		const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

		const daemon = new ProcessManagerDaemon();
		const daemonInternal = daemon as unknown as {
			handleRequest: ( request: unknown ) => Promise< unknown >;
			broadcastEvent: ( event: unknown ) => Promise< void >;
		};
		const broadcastSpy = vi
			.spyOn( daemonInternal, 'broadcastEvent' )
			.mockResolvedValue( undefined );

		await daemonInternal.handleRequest( {
			type: 'start-process',
			requestId: '1',
			processName: testProcessName,
			scriptPath: '/tmp/test-child.js',
			env: {},
			args: [],
		} );

		child.stderr.write( 'SyntaxError: boom\n' );
		child.stderr.write( '    at Module._compile\n' );
		// Let readline consume the lines before triggering exit.
		await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );

		child.emit( 'exit', 1 );
		await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );

		const exitCall = broadcastSpy.mock.calls.find( ( [ event ] ) => {
			const payload = ( event as { type: string; payload: { event: string } } ).payload;
			return payload.event === 'exit';
		} );

		expect( exitCall ).toBeDefined();
		const payload = ( exitCall![ 0 ] as { payload: { stderrTail?: string } } ).payload;
		expect( payload.stderrTail ).toContain( 'SyntaxError: boom' );
		expect( payload.stderrTail ).toContain( 'at Module._compile' );
	} );

	it( 'reuses duplicate starts, forwards messages, and resolves missing stops', async () => {
		const child = new MockChildProcess();
		spawnMock.mockReturnValue( child );
		const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

		const daemon = new ProcessManagerDaemon();
		const daemonInternal = daemon as unknown as {
			handleRequest: ( request: unknown ) => Promise< {
				type: string;
				payload: { process?: { pmId: number; name: string; status: string; pid?: number } };
			} >;
		};
		const first = await daemonInternal.handleRequest( {
			type: 'start-process',
			requestId: '1',
			processName: testProcessName,
			scriptPath: '/tmp/test-child.js',
			env: {},
			args: [],
		} );
		const second = await daemonInternal.handleRequest( {
			type: 'start-process',
			requestId: '2',
			processName: testProcessName,
			scriptPath: '/tmp/test-child.js',
			env: {},
			args: [],
		} );

		const firstProcess = first.payload.process;
		const secondProcess = second.payload.process;
		if ( ! firstProcess || ! secondProcess ) {
			throw new Error( 'Expected both start-process responses to include a process' );
		}

		expect( secondProcess.pmId ).toBe( firstProcess.pmId );
		expect( spawnMock ).toHaveBeenCalledTimes( 1 );

		await daemonInternal.handleRequest( {
			type: 'send-message-to-process',
			requestId: '3',
			processId: firstProcess.pmId,
			message: { topic: 'stop-server', messageId: 'msg-1', data: {} },
		} );
		expect( child.send ).toHaveBeenCalledWith(
			{ topic: 'stop-server', messageId: 'msg-1', data: {} },
			expect.any( Function )
		);

		await expect(
			daemonInternal.handleRequest( {
				type: 'stop-process',
				requestId: '4',
				processName: 'missing-process',
			} )
		).resolves.toEqual( {
			type: 'result',
			payload: {},
		} );
	} );

	it( 'settles a stop even when the child never reports exit', async () => {
		const child = new MockChildProcess();
		// Simulate an unkillable child: neither kill() nor the SIGKILL escalation produce 'exit'.
		child.kill = vi.fn( () => true );
		spawnMock.mockReturnValue( child );
		const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

		const daemon = new ProcessManagerDaemon();
		const daemonInternal = daemon as unknown as {
			handleRequest: ( request: unknown ) => Promise< {
				type: string;
				payload: { process?: { pmId: number; name: string; status: string; pid?: number } };
			} >;
			managedProcesses: Map< number, unknown >;
			broadcastEvent: ( event: unknown ) => Promise< void >;
		};
		vi.spyOn( daemonInternal, 'broadcastEvent' ).mockResolvedValue( undefined );
		const killSpy = vi.spyOn( process, 'kill' ).mockImplementation( () => true );
		vi.useFakeTimers();

		try {
			await daemonInternal.handleRequest( {
				type: 'start-process',
				requestId: '1',
				processName: testProcessName,
				scriptPath: '/tmp/test-child.js',
				env: {},
				args: [],
			} );

			const stopPromise = daemonInternal.handleRequest( {
				type: 'stop-process',
				requestId: '2',
				processName: testProcessName,
			} );

			// First STOP_TIMEOUT_MS escalates to SIGKILL, second force-settles the process.
			await vi.advanceTimersByTimeAsync( 2500 );
			await vi.advanceTimersByTimeAsync( 2500 );

			await expect( stopPromise ).resolves.toEqual( { type: 'result', payload: {} } );
			expect( daemonInternal.managedProcesses.size ).toBe( 0 );
		} finally {
			vi.useRealTimers();
			killSpy.mockRestore();
		}
	} );

	it.skipIf( process.platform === 'win32' )(
		'signals the wrapper group and each reported subprocess group when killing the wrapper',
		async () => {
			const child = new MockChildProcess();
			spawnMock.mockReturnValue( child );
			const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

			const daemon = new ProcessManagerDaemon();
			const daemonInternal = daemon as unknown as {
				handleRequest: ( request: unknown ) => Promise< {
					type: string;
					payload: { process?: { pmId: number; name: string; status: string; pid?: number } };
				} >;
				managedProcesses: Map< number, unknown >;
				signalProcessGroup: ( managedProcess: unknown, signal: NodeJS.Signals ) => Promise< void >;
			};

			const response = await daemonInternal.handleRequest( {
				type: 'start-process',
				requestId: '1',
				processName: testProcessName,
				scriptPath: '/tmp/test-child.js',
				env: {},
				args: [],
			} );

			const processDesc = response.payload.process;
			if ( ! processDesc ) {
				throw new Error( 'Expected start-process response to include a process' );
			}

			child.emit( 'message', { topic: 'server-process-started', data: { pid: 9876 } } );

			const managedProcess = daemonInternal.managedProcesses.get( processDesc.pmId );
			if ( ! managedProcess ) {
				throw new Error( 'Expected process manager to store the managed process' );
			}

			const killSpy = vi.spyOn( process, 'kill' ).mockImplementation( () => true );
			try {
				await daemonInternal.signalProcessGroup( managedProcess, 'SIGKILL' );
				expect( killSpy ).toHaveBeenCalledWith( -4321, 'SIGKILL' );
				expect( killSpy ).toHaveBeenCalledWith( -9876, 'SIGKILL' );
			} finally {
				killSpy.mockRestore();
			}
		}
	);

	describe( 'weighted capacity limit', () => {
		type HandleRequestFn = ( request: unknown ) => Promise< {
			type: string;
			payload: { process?: { pmId: number; name: string; status: string; pid?: number } };
		} >;

		async function startSiteProcess(
			handleRequest: HandleRequestFn,
			index: number,
			runtime: string = SITE_RUNTIME_NATIVE_PHP
		) {
			return handleRequest( {
				type: 'start-process',
				requestId: String( index ),
				processName: `studio-site-site-${ index }`,
				scriptPath: '/tmp/test-child.js',
				env: {},
				args: [],
				runtime,
			} );
		}

		it( 'rejects a site process when the weighted capacity limit is exceeded', async () => {
			spawnMock.mockImplementation( () => new MockChildProcess() );
			const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

			const daemon = new ProcessManagerDaemon();
			const handleRequest = (
				daemon as unknown as { handleRequest: HandleRequestFn }
			 ).handleRequest.bind( daemon );
			vi.spyOn(
				daemon as unknown as { broadcastEvent: ( event: unknown ) => Promise< void > },
				'broadcastEvent'
			).mockResolvedValue( undefined );

			// Start 36 native-php sites (weight 1 each = 36 total, at the limit)
			for ( let i = 0; i < 36; i++ ) {
				await startSiteProcess( handleRequest, i );
			}

			// The 37th native-php site should be rejected
			await expect( startSiteProcess( handleRequest, 37 ) ).rejects.toThrow(
				'CAPACITY_LIMIT_REACHED'
			);
		} );

		it( 'counts playground sites with weight 6', async () => {
			spawnMock.mockImplementation( () => new MockChildProcess() );
			const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

			const daemon = new ProcessManagerDaemon();
			const handleRequest = (
				daemon as unknown as { handleRequest: HandleRequestFn }
			 ).handleRequest.bind( daemon );
			vi.spyOn(
				daemon as unknown as { broadcastEvent: ( event: unknown ) => Promise< void > },
				'broadcastEvent'
			).mockResolvedValue( undefined );

			// Start 6 playground sites (weight 6 each = 36 total, at the limit)
			for ( let i = 0; i < 6; i++ ) {
				await startSiteProcess( handleRequest, i, SITE_RUNTIME_PLAYGROUND );
			}

			// The 7th playground site should be rejected
			await expect( startSiteProcess( handleRequest, 7, SITE_RUNTIME_PLAYGROUND ) ).rejects.toThrow(
				'CAPACITY_LIMIT_REACHED'
			);
		} );

		it( 'does not count non-site processes toward capacity', async () => {
			spawnMock.mockImplementation( () => new MockChildProcess() );
			const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

			const daemon = new ProcessManagerDaemon();
			const handleRequest = (
				daemon as unknown as { handleRequest: HandleRequestFn }
			 ).handleRequest.bind( daemon );
			vi.spyOn(
				daemon as unknown as { broadcastEvent: ( event: unknown ) => Promise< void > },
				'broadcastEvent'
			).mockResolvedValue( undefined );

			// Start a non-site process (e.g. proxy)
			await handleRequest( {
				type: 'start-process',
				requestId: '0',
				processName: 'studio-proxy',
				scriptPath: '/tmp/proxy.js',
				env: {},
				args: [],
			} );

			// Should still be able to start 36 native-php site processes
			for ( let i = 0; i < 36; i++ ) {
				await startSiteProcess( handleRequest, i );
			}
		} );

		it( 'allows restarting an already-running process regardless of capacity', async () => {
			spawnMock.mockImplementation( () => new MockChildProcess() );
			const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

			const daemon = new ProcessManagerDaemon();
			const handleRequest = (
				daemon as unknown as { handleRequest: HandleRequestFn }
			 ).handleRequest.bind( daemon );
			vi.spyOn(
				daemon as unknown as { broadcastEvent: ( event: unknown ) => Promise< void > },
				'broadcastEvent'
			).mockResolvedValue( undefined );

			// Fill capacity
			for ( let i = 0; i < 36; i++ ) {
				await startSiteProcess( handleRequest, i );
			}

			// Re-starting an existing process should succeed (early return, no capacity check)
			const result = await startSiteProcess( handleRequest, 0 );
			expect( result.payload.process?.status ).toBe( 'online' );
		} );
	} );

	it( 'taskkills the wrapper and reported subprocess trees on Windows', async () => {
		const child = new MockChildProcess();
		spawnMock.mockReturnValue( child );
		const { ProcessManagerDaemon } = await import( '../process-manager-daemon' );

		const daemon = new ProcessManagerDaemon();
		const daemonInternal = daemon as unknown as {
			handleRequest: ( request: unknown ) => Promise< {
				type: string;
				payload: { process?: { pmId: number; name: string; status: string; pid?: number } };
			} >;
			managedProcesses: Map< number, unknown >;
			signalProcessGroup: ( managedProcess: unknown, signal: NodeJS.Signals ) => Promise< void >;
		};

		const response = await daemonInternal.handleRequest( {
			type: 'start-process',
			requestId: '1',
			processName: testProcessName,
			scriptPath: '/tmp/test-child.js',
			env: {},
			args: [],
		} );

		const processDesc = response.payload.process;
		if ( ! processDesc ) {
			throw new Error( 'Expected start-process response to include a process' );
		}

		child.emit( 'message', { topic: 'server-process-started', data: { pid: 9876 } } );

		const managedProcess = daemonInternal.managedProcesses.get( processDesc.pmId );
		if ( ! managedProcess ) {
			throw new Error( 'Expected process manager to store the managed process' );
		}

		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32', configurable: true } );
		try {
			await daemonInternal.signalProcessGroup( managedProcess, 'SIGKILL' );
			expect( spawnSyncMock ).toHaveBeenCalledWith(
				'taskkill',
				[ '/F', '/T', '/PID', '4321' ],
				expect.objectContaining( { windowsHide: true } )
			);
			expect( spawnSyncMock ).toHaveBeenCalledWith(
				'taskkill',
				[ '/F', '/T', '/PID', '9876' ],
				expect.objectContaining( { windowsHide: true } )
			);
		} finally {
			Object.defineProperty( process, 'platform', {
				value: originalPlatform,
				configurable: true,
			} );
		}
	} );
} );
