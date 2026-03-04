import { ChildProcess, fork } from 'child_process';
import fs, { createWriteStream, WriteStream } from 'fs';
import net from 'net';
import path from 'path';
import {
	PROCESS_MANAGER_LOGS_DIR,
	PROCESS_MANAGER_CONTROL_SOCKET_PATH,
	PROCESS_MANAGER_EVENTS_SOCKET_PATH,
} from 'cli/lib/process-manager';
import { SocketServer } from 'cli/lib/socket';
import { ProcessDescription } from 'cli/lib/types/pm2';
import {
	DaemonEvent,
	DaemonResponseResult,
	DaemonRequest,
	daemonEventSchema,
	daemonRequestSchema,
} from 'cli/lib/types/process-manager-ipc';
import { ManagerMessage } from 'cli/lib/types/wordpress-server-ipc';

const SOCKET_TIMEOUT_MS = 2_500;
const STOP_TIMEOUT_MS = 5_000;

interface ManagedProcess {
	pmId: number;
	name: string;
	scriptPath: string;
	args: string[];
	env: Record< string, string >;
	child: ChildProcess;
	pid?: number;
	status: string;
	stdoutLogPath: string;
	stderrLogPath: string;
	stdoutStream: WriteStream;
	stderrStream: WriteStream;
	settled: boolean;
}

function ensureProcessManagerDirs() {
	fs.mkdirSync( PROCESS_MANAGER_LOGS_DIR, { recursive: true } );
}

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
	private readonly managedProcessesByName = new Map< string, ManagedProcess >();
	private nextPmId = 1;
	private shuttingDown = false;

	async start(): Promise< void > {
		ensureProcessManagerDirs();
		this.controlServer.on( 'message', ( { message, socket } ) => {
			void this.handleDecodedRequest( socket, message );
		} );
		await this.controlServer.listen();
		await this.eventsServer.listen();

		process.on( 'SIGINT', () => void this.shutdown( 'signal' ) );
		process.on( 'SIGTERM', () => void this.shutdown( 'signal' ) );
		process.on( 'exit', () => {
			void this.forceCleanupChildren();
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

	private async startProcess(
		processName: string,
		scriptPath: string,
		env: Record< string, string >,
		args: string[]
	): Promise< ProcessDescription > {
		const existing = this.managedProcessesByName.get( processName );
		if ( existing && existing.status === 'online' ) {
			return this.toProcessDescription( existing );
		}

		const pmId = this.nextPmId++;
		const { stdoutLogPath, stderrLogPath } = getProcessLogPaths( processName );
		const stdoutStream = createWriteStream( stdoutLogPath, { flags: 'a' } );
		const stderrStream = createWriteStream( stderrLogPath, { flags: 'a' } );
		const child = fork( scriptPath, args, {
			execPath: process.execPath,
			execArgv: [ '--experimental-wasm-jspi' ],
			env: { ...process.env, ...env },
			silent: true,
		} );

		const managedProcess: ManagedProcess = {
			pmId,
			name: processName,
			scriptPath,
			args,
			env,
			child,
			pid: child.pid,
			status: 'online',
			stdoutLogPath,
			stderrLogPath,
			stdoutStream,
			stderrStream,
			settled: false,
		};

		this.managedProcesses.set( pmId, managedProcess );
		this.managedProcessesByName.set( processName, managedProcess );

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
			void this.handleProcessExit( managedProcess, 'exit' );
		} );

		child.on( 'exit', () => {
			void this.handleProcessExit( managedProcess, 'exit' );
		} );

		const onlineEvent = daemonEventSchema.parse( {
			type: 'process-event',
			payload: {
				process: { name: processName, pm_id: pmId },
				event: 'online',
			},
		} );
		await this.broadcastEvent( onlineEvent );

		return this.toProcessDescription( managedProcess );
	}

	private async stopProcess( processName: string ): Promise< void > {
		const managedProcess = this.managedProcessesByName.get( processName );

		if ( ! managedProcess || managedProcess.settled ) {
			return;
		}

		await new Promise< void >( ( resolve ) => {
			const timeoutId = setTimeout( () => {
				managedProcess.child.kill( 'SIGKILL' );
			}, STOP_TIMEOUT_MS );

			managedProcess.child.once( 'exit', () => {
				clearTimeout( timeoutId );
				void this.broadcastEvent(
					daemonEventSchema.parse( {
						type: 'process-event',
						payload: {
							process: { name: managedProcess.name, pm_id: managedProcess.pmId },
							event: 'delete',
						},
					} )
				);
				resolve();
			} );

			managedProcess.child.kill( 'SIGTERM' );
		} );
	}

	private async handleProcessExit( managedProcess: ManagedProcess, eventName: string ) {
		if ( managedProcess.settled ) {
			return;
		}

		managedProcess.settled = true;
		managedProcess.status = 'stopped';
		this.managedProcesses.delete( managedProcess.pmId );
		this.managedProcessesByName.delete( managedProcess.name );
		managedProcess.stdoutStream.end();
		managedProcess.stderrStream.end();

		const exitEvent = daemonEventSchema.parse( {
			type: 'process-event',
			payload: {
				process: { name: managedProcess.name, pm_id: managedProcess.pmId },
				event: eventName,
			},
		} );
		await this.broadcastEvent( exitEvent );
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
		return {
			name: managedProcess.name,
			pmId: managedProcess.pmId,
			status: managedProcess.status,
			pid: managedProcess.pid,
		};
	}

	private async forceCleanupChildren() {
		await Promise.allSettled(
			Array.from( this.managedProcesses.values() ).map( async ( managedProcess ) => {
				if ( managedProcess.settled ) {
					return;
				}
				managedProcess.child.kill( 'SIGKILL' );
			} )
		);
	}

	async shutdown( reason?: string ): Promise< void > {
		if ( this.shuttingDown ) {
			return;
		}

		this.shuttingDown = true;
		await this.broadcastEvent(
			daemonEventSchema.parse( {
				type: 'daemon-kill',
				payload: { reason },
			} )
		);

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
