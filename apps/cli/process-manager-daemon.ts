import { ChildProcess, spawn, spawnSync } from 'child_process';
import fs, { createWriteStream, WriteStream } from 'fs';
import net from 'net';
import path from 'path';
import readline from 'readline';
import semver from 'semver';
import {
	PROCESS_MANAGER_LOGS_DIR,
	PROCESS_MANAGER_CONTROL_SOCKET_PATH,
	PROCESS_MANAGER_EVENTS_SOCKET_PATH,
} from 'cli/lib/paths';
import { SocketServer } from 'cli/lib/socket';
import {
	ProcessDescription,
	DaemonEvent,
	DaemonResponseResult,
	daemonEventSchema,
	DaemonRequest,
	daemonRequestSchema,
} from 'cli/lib/types/process-manager-ipc';
import { ManagerMessage } from 'cli/lib/types/wordpress-server-ipc';

const SOCKET_TIMEOUT_MS = 2_500;
const STOP_TIMEOUT_MS = 2_500;

// In-memory tail of stderr kept per child so we can include the current invocation's error
// output in the `exit` event. Bounded to avoid unbounded memory growth on chatty processes.
const STDERR_BUFFER_MAX_LINES = 100;
const STDERR_BUFFER_MAX_BYTES = 16 * 1024;

type ManagedProcessBase = {
	pmId: number;
	name: string;
	scriptPath: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	child: ChildProcess;
	stdoutLogPath: string;
	stderrLogPath: string;
	stdoutStream: WriteStream;
	stderrStream: WriteStream;
	stderrBuffer: string[];
	stderrBufferBytes: number;
	settled: boolean;
};
type ManagedProcessRunning = ManagedProcessBase & {
	pid: number;
	status: 'online';
};
type ManagedProcessStopped = ManagedProcessBase & {
	status: 'stopped';
};
type ManagedProcess = ManagedProcessRunning | ManagedProcessStopped;

function formatLogDateTag( date: Date ): string {
	const year = date.getFullYear();
	const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
	const day = String( date.getDate() ).padStart( 2, '0' );
	return `${ year }${ month }${ day }`;
}

function getProcessLogPaths( processName: string, date: Date = new Date() ) {
	const dateTag = formatLogDateTag( date );
	return {
		stdoutLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-out-${ dateTag }.log` ),
		stderrLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-error-${ dateTag }.log` ),
	};
}

function timestampLogLine( line: string ): string {
	return `${ new Date().toISOString() } ${ line }\n`;
}

function writeTimestampedLines( target: WriteStream, content: string ) {
	const normalizedContent = content.split( '\r\n' ).join( '\n' );
	const lines = normalizedContent.trimEnd().split( '\n' );

	lines.forEach( ( line ) => {
		target.write( timestampLogLine( line ) );
	} );
}

export class ProcessManagerDaemon {
	private readonly controlServer = new SocketServer(
		PROCESS_MANAGER_CONTROL_SOCKET_PATH,
		SOCKET_TIMEOUT_MS
	);
	private readonly eventsServer = new SocketServer(
		PROCESS_MANAGER_EVENTS_SOCKET_PATH,
		SOCKET_TIMEOUT_MS
	);
	private readonly managedProcesses = new Map< number, ManagedProcess >();
	private nextPmId = 1;
	private shutdownPromise: Promise< void > | null = null;

	async start(): Promise< void > {
		fs.mkdirSync( PROCESS_MANAGER_LOGS_DIR, { recursive: true } );
		this.controlServer.on( 'message', ( { message, socket } ) => {
			void this.handleDecodedRequest( socket, message );
		} );
		await this.eventsServer.listen();
		await this.controlServer.listen();

		process.on( 'SIGINT', () => void this.shutdown( 'signal' ) );
		process.on( 'SIGTERM', () => void this.shutdown( 'signal' ) );
		process.on( 'exit', () => {
			this.forceCleanupChildren();
		} );
	}

	private async handleDecodedRequest( socket: net.Socket, payload: unknown ): Promise< void > {
		const parsed = daemonRequestSchema.safeParse( payload );
		if ( ! parsed.success ) {
			this.controlServer.sendAndClose( socket, {
				type: 'error',
				error: { message: parsed.error.message },
			} );
			return;
		}

		const request = parsed.data;

		try {
			const response = await this.handleRequest( request );
			this.controlServer.sendAndClose( socket, response );

			if ( request.type === 'kill-daemon' ) {
				setImmediate( () => {
					void this.finalizeShutdownByClosingSocketServersAndExiting();
				} );
			}
		} catch ( error ) {
			const err = error instanceof Error ? error : new Error( String( error ) );
			this.controlServer.sendAndClose( socket, {
				type: 'error',
				error: { message: err.message, stack: err.stack },
			} );
		}
	}

	private async handleRequest( request: DaemonRequest ): Promise< DaemonResponseResult > {
		switch ( request.type ) {
			case 'ping':
				return {
					type: 'result',
					payload: {},
				};
			case 'start-process': {
				const processDesc = await this.startProcess(
					request.processName,
					request.scriptPath,
					request.env ?? {},
					request.args ?? []
				);
				return {
					type: 'result',
					payload: { process: processDesc },
				};
			}
			case 'stop-process':
				await this.stopProcess( request.processName );
				return {
					type: 'result',
					payload: {},
				};
			case 'list-processes':
				return {
					type: 'result',
					payload: { processes: this.listProcesses() },
				};
			case 'send-message-to-process':
				await this.sendMessageToProcess( request.processId, request.message );
				return {
					type: 'result',
					payload: {},
				};
			case 'kill-daemon':
				await this.beginShutdownByKillingChildren( 'kill-daemon' );
				return {
					type: 'result',
					payload: {},
				};
		}
	}

	private listProcesses(): ProcessDescription[] {
		return Array.from( this.managedProcesses.values() ).map( this.toProcessDescription );
	}

	private getManagedProcessByName( processName: string ): ManagedProcess | undefined {
		for ( const managedProcess of this.managedProcesses.values() ) {
			if ( managedProcess.name === processName ) {
				return managedProcess;
			}
		}
		return undefined;
	}

	private async startProcess(
		processName: string,
		scriptPath: string,
		env: NodeJS.ProcessEnv,
		args: string[]
	): Promise< ProcessDescription > {
		const existing = this.getManagedProcessByName( processName );
		if ( existing && existing.status === 'online' ) {
			return this.toProcessDescription( existing );
		}

		const pmId = this.nextPmId++;
		const { stdoutLogPath, stderrLogPath } = getProcessLogPaths( processName );
		const stdoutStream = createWriteStream( stdoutLogPath, { flags: 'a' } );
		const stderrStream = createWriteStream( stderrLogPath, { flags: 'a' } );
		// Node.js >=24 supports the JSPI (JavaScript Promises Integration) API
		const doesCurrentNodeSupportJspi = semver.gte( process.version, '24.0.0' );
		const execArgv = doesCurrentNodeSupportJspi ? [ '--experimental-wasm-jspi' ] : [];
		const child = spawn( process.execPath, [ ...execArgv, scriptPath, ...args ], {
			env,
			stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
			windowsHide: true,
			detached: process.platform !== 'win32',
		} );

		const managedProcess: ManagedProcessRunning = {
			pmId,
			name: processName,
			scriptPath,
			args,
			env,
			child,
			// `child.pid` is only undefined if there's an error, in which case our error handler
			// immediately changes the status and deletes the process from the map
			pid: child.pid as number,
			status: 'online',
			stdoutLogPath,
			stderrLogPath,
			stdoutStream,
			stderrStream,
			stderrBuffer: [],
			stderrBufferBytes: 0,
			settled: false,
		};

		this.managedProcesses.set( pmId, managedProcess );

		this.pipeOutputWithTimestamp( child.stdout, stdoutStream );
		this.pipeOutputWithTimestamp( child.stderr, stderrStream, ( line ) => {
			this.recordStderrLine( managedProcess, line );
		} );

		child.on( 'message', ( raw ) => {
			const event = daemonEventSchema.safeParse( {
				type: 'process-message',
				payload: {
					process: { name: processName, pm_id: pmId },
					raw,
				},
			} );

			if ( event.success ) {
				void this.broadcastEvent( event.data );
			}
		} );

		child.on( 'error', ( error ) => {
			const errorText = error.stack ?? error.message;
			writeTimestampedLines( stderrStream, errorText );
			for ( const line of errorText.split( '\n' ) ) {
				this.recordStderrLine( managedProcess, line );
			}
			void this.handleProcessExit( managedProcess );
		} );

		child.on( 'exit', () => {
			void this.handleProcessExit( managedProcess );
		} );

		await this.broadcastEvent( {
			type: 'process-event',
			payload: {
				process: { name: processName, pm_id: pmId },
				event: 'online',
			},
		} );

		return this.toProcessDescription( managedProcess );
	}

	private async stopProcess( processName: string ): Promise< void > {
		const managedProcess = this.getManagedProcessByName( processName );

		if ( ! managedProcess || managedProcess.settled ) {
			return;
		}

		await new Promise< void >( ( resolve ) => {
			const timeoutId = setTimeout( () => {
				this.signalProcessGroup( managedProcess, 'SIGKILL' );
			}, STOP_TIMEOUT_MS );

			managedProcess.child.once( 'exit', () => {
				clearTimeout( timeoutId );
				void this.broadcastEvent( {
					type: 'process-event',
					payload: {
						process: { name: managedProcess.name, pm_id: managedProcess.pmId },
						event: 'delete',
					},
				} );
				resolve();
			} );

			this.signalProcessGroup( managedProcess, 'SIGTERM' );
		} );
	}

	private async handleProcessExit( managedProcess: ManagedProcess ) {
		if ( managedProcess.settled ) {
			return;
		}

		managedProcess.settled = true;
		managedProcess.status = 'stopped';
		this.managedProcesses.delete( managedProcess.pmId );
		managedProcess.stdoutStream.end();
		managedProcess.stderrStream.end();

		const stderrTail = managedProcess.stderrBuffer.join( '\n' );

		await this.broadcastEvent( {
			type: 'process-event',
			payload: {
				process: { name: managedProcess.name, pm_id: managedProcess.pmId },
				event: 'exit',
				...( stderrTail ? { stderrTail } : {} ),
			},
		} );
	}

	private async sendMessageToProcess( processId: number, message: ManagerMessage ) {
		const managedProcess = this.managedProcesses.get( processId );
		if ( ! managedProcess ) {
			throw new Error( `Process with id ${ processId } not found` );
		}

		if ( ! managedProcess.child.connected ) {
			throw new Error( `Process with id ${ processId } is not connected` );
		}

		await new Promise< void >( ( resolve, reject ) => {
			managedProcess.child.send( message, ( error ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve();
			} );
		} );
	}

	private async broadcastEvent( event: DaemonEvent ): Promise< void > {
		this.eventsServer.broadcast( event );
	}

	private pipeOutputWithTimestamp(
		input: NodeJS.ReadableStream | null,
		target: WriteStream,
		onLine?: ( line: string ) => void
	): void {
		if ( ! input ) {
			return;
		}

		const lineReader = readline.createInterface( {
			input,
			crlfDelay: Infinity,
		} );

		lineReader.on( 'line', ( line ) => {
			void target.write( timestampLogLine( line ) );
			onLine?.( line );
		} );
	}

	private recordStderrLine( managedProcess: ManagedProcess, line: string ): void {
		managedProcess.stderrBuffer.push( line );
		managedProcess.stderrBufferBytes += Buffer.byteLength( line, 'utf8' ) + 1; // +1 for the joining newline

		while (
			managedProcess.stderrBuffer.length > STDERR_BUFFER_MAX_LINES ||
			managedProcess.stderrBufferBytes > STDERR_BUFFER_MAX_BYTES
		) {
			const dropped = managedProcess.stderrBuffer.shift();
			if ( dropped === undefined ) {
				break;
			}
			managedProcess.stderrBufferBytes -= Buffer.byteLength( dropped, 'utf8' ) + 1;
		}
	}

	private toProcessDescription( managedProcess: ManagedProcess ): ProcessDescription {
		if ( managedProcess.status === 'stopped' ) {
			return {
				name: managedProcess.name,
				pmId: managedProcess.pmId,
				status: managedProcess.status,
			};
		}

		return {
			name: managedProcess.name,
			pmId: managedProcess.pmId,
			status: managedProcess.status,
			pid: managedProcess.pid,
		};
	}

	private forceCleanupChildren() {
		for ( const managedProcess of this.managedProcesses.values() ) {
			if ( managedProcess.settled ) {
				continue;
			}
			this.signalProcessGroup( managedProcess, 'SIGKILL' );
		}
	}

	private signalProcessGroup( managedProcess: ManagedProcess, signal: NodeJS.Signals ): void {
		const pid = managedProcess.child.pid;
		if ( ! pid ) {
			return;
		}

		if ( process.platform === 'win32' ) {
			if ( signal === 'SIGKILL' ) {
				// Windows has no process-group concept Node can reach. /T walks the descendant
				// tree via parent-PID lookup; /F forces termination. Without /T, grandchildren
				// (e.g. the PHP server spawned by the wrapper) would be orphaned.
				spawnSync( 'taskkill', [ '/F', '/T', '/PID', String( pid ) ], {
					windowsHide: true,
					stdio: 'ignore',
				} );
				return;
			}
			// Console apps on Windows have no SIGTERM equivalent — `child.kill( 'SIGTERM' )`
			// maps to TerminateProcess of a single PID, so neither cleanup nor tree-walk runs.
			// Closing the IPC channel triggers the wrapper's 'disconnect' handler instead, which
			// kills the PHP child and exits cleanly. Force escalation falls back to taskkill /T.
			if ( managedProcess.child.connected ) {
				try {
					managedProcess.child.disconnect();
				} catch {
					// Do nothing
				}
				return;
			}
			try {
				managedProcess.child.kill( signal );
			} catch {
				// Do nothing
			}
			return;
		}

		// Children are spawned with `detached: true` on non-Windows, so each lives in its own
		// process group. Signalling the negative PID delivers to every member of that group,
		// including grandchildren (e.g. the PHP server spawned by the wrapper).
		try {
			process.kill( -pid, signal );
		} catch {
			// Group send can fail if the leader has already exited but children remain.
			try {
				managedProcess.child.kill( signal );
			} catch {
				// Do nothing
			}
		}
	}

	private async shutdown( reason?: string ): Promise< void > {
		await this.beginShutdownByKillingChildren( reason );
		await this.finalizeShutdownByClosingSocketServersAndExiting();
	}

	private beginShutdownByKillingChildren( reason?: string ): Promise< void > {
		const stopAllChildren = async (): Promise< void > => {
			await Promise.allSettled(
				Array.from( this.managedProcesses.values() ).map( ( managedProcess ) =>
					this.stopProcess( managedProcess.name )
				)
			);

			await this.broadcastEvent( {
				type: 'daemon-kill',
				payload: { reason },
			} );
		};

		// Track in-flight shutdown so concurrent callers (e.g. kill-daemon + a SIGTERM)
		// share the same work and all wait for it to finish.
		if ( ! this.shutdownPromise ) {
			this.shutdownPromise = stopAllChildren().finally( () => {
				this.shutdownPromise = null;
			} );
		}
		return this.shutdownPromise;
	}

	private async finalizeShutdownByClosingSocketServersAndExiting(): Promise< void > {
		await this.controlServer.close();
		await this.eventsServer.close();
		process.exit( 0 );
	}
}

async function main() {
	try {
		const daemon = new ProcessManagerDaemon();
		await daemon.start();
	} catch ( error ) {
		console.error( error );
	}
}

void main();
