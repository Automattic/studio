import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
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

vi.mock( 'child_process', () => {
	const mockedModule = {
		spawn: spawnMock,
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
		} );

		expect( response ).toEqual(
			expect.objectContaining( {
				type: 'result',
				payload: expect.objectContaining( {
					process: expect.objectContaining( {
						name: testProcessName,
						status: 'online',
						pid: 4321,
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

		expect(
			fs.readFileSync( path.join( tmpDir, 'logs', `${ testProcessName }-out.log` ), 'utf8' )
		).toContain( 'fixture-stdout' );
		expect(
			fs.readFileSync( path.join( tmpDir, 'logs', `${ testProcessName }-error.log` ), 'utf8' )
		).toContain( 'fixture-stderr' );
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
} );
