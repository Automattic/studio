import { ChildProcess, spawn } from 'child_process';
import fs, { createWriteStream, WriteStream } from 'fs';
import net from 'net';
import path from 'path';
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
const STOP_TIMEOUT_MS = 5_000;

type ManagedProcessBase = {
	pmId: number;
	name: string;
	scriptPath: string;
	args: string[];
	env: Record< string, string >;
	child: ChildProcess;
	stdoutLogPath: string;
	stderrLogPath: string;
	stdoutStream: WriteStream;
	stderrStream: WriteStream;
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

function getProcessLogPaths( processName: string ) {
	return {
		stdoutLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-out.log` ),
		stderrLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-error.log` ),
	};
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
	private shuttingDown = false;

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
					void this.shutdown( 'kill-daemon' );
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
		env: Record< string, string >,
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
			env: { ...process.env, ...env },
			stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
			windowsHide: true,
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
			settled: false,
		};

		this.managedProcesses.set( pmId, managedProcess );

		child.stdout?.pipe( stdoutStream );
		child.stderr?.pipe( stderrStream );

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
			void stderrStream.write( `${ error.stack ?? error.message }\n` );
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
				managedProcess.child.kill( 'SIGKILL' );
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

			managedProcess.child.kill( 'SIGTERM' );
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

		await this.broadcastEvent( {
			type: 'process-event',
			payload: {
				process: { name: managedProcess.name, pm_id: managedProcess.pmId },
				event: 'exit',
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
			try {
				managedProcess.child.kill( 'SIGKILL' );
			} catch {
				// Do nothing
			}
		}
	}

	async shutdown( reason?: string ): Promise< void > {
		if ( this.shuttingDown ) {
			return;
		}

		this.shuttingDown = true;
		await this.broadcastEvent( {
			type: 'daemon-kill',
			payload: { reason },
		} );

		await Promise.allSettled(
			Array.from( this.managedProcesses.values() ).map( ( managedProcess ) =>
				this.stopProcess( managedProcess.name )
			)
		);

		await new Promise< void >( ( resolve ) => {
			void this.controlServer.close().then( () => resolve() );
		} );
		await this.eventsServer.close();
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
