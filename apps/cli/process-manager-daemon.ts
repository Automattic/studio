import fs from 'fs';
import net from 'net';
import {
	PROCESS_MANAGER_LOGS_DIR,
	PROCESS_MANAGER_CONTROL_SOCKET_PATH,
	PROCESS_MANAGER_EVENTS_SOCKET_PATH,
} from 'cli/lib/paths';
import {
	ManagedProcess,
	ManagedProcessCallbacks,
	ManagedProcessEvent,
} from 'cli/lib/process-manager/managed-process';
import { ProxyProcess } from 'cli/lib/process-manager/managed-process-proxy';
import { ManagedProcessWordPressNativePhp } from 'cli/lib/process-manager/managed-process-wordpress-native-php';
import { ManagedProcessWordPressPlayground } from 'cli/lib/process-manager/managed-process-wordpress-playground';
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

type StartProcessRequest = Extract< DaemonRequest, { type: 'start-process' } >;

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
				const processDesc = await this.startProcess( request );
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
		return Array.from( this.managedProcesses.values() ).map( ( managedProcess ) =>
			managedProcess.toProcessDescription()
		);
	}

	private getManagedProcessByName( processName: string ): ManagedProcess | undefined {
		for ( const managedProcess of this.managedProcesses.values() ) {
			if ( managedProcess.name === processName ) {
				return managedProcess;
			}
		}
		return undefined;
	}

	private async startProcess( request: StartProcessRequest ): Promise< ProcessDescription > {
		const existing = this.getManagedProcessByName( request.processName );
		if ( existing && existing.status === 'online' ) {
			return existing.toProcessDescription();
		}

		const managedProcess = this.createManagedProcess( request );
		this.managedProcesses.set( managedProcess.pmId, managedProcess );

		try {
			await managedProcess.start();
		} catch ( error ) {
			this.managedProcesses.delete( managedProcess.pmId );
			await managedProcess.forceStop();
			throw error;
		}

		return managedProcess.toProcessDescription();
	}

	private createManagedProcess( request: StartProcessRequest ): ManagedProcess {
		const processOptions = {
			pmId: this.nextPmId++,
			name: request.processName,
			callbacks: this.createProcessCallbacks(),
		};

		switch ( request.processKind ) {
			case 'proxy':
				return new ProxyProcess( processOptions );
			case 'wordpress-server':
				if ( request.wordpressRuntime === 'native-php' ) {
					return new ManagedProcessWordPressNativePhp( processOptions );
				}
				return new ManagedProcessWordPressPlayground( processOptions );
		}
	}

	private createProcessCallbacks(): ManagedProcessCallbacks {
		return {
			onEvent: ( managedProcess, event ) => this.broadcastProcessEvent( managedProcess, event ),
			onExit: ( managedProcess ) => {
				this.managedProcesses.delete( managedProcess.pmId );
			},
			onMessage: ( managedProcess, raw ) => this.broadcastProcessMessage( managedProcess, raw ),
		};
	}

	private async stopProcess( processName: string ): Promise< void > {
		const managedProcess = this.getManagedProcessByName( processName );

		if ( ! managedProcess || managedProcess.status !== 'online' ) {
			return;
		}

		await managedProcess.stop();
	}

	private async sendMessageToProcess( processId: number, message: ManagerMessage ) {
		const managedProcess = this.managedProcesses.get( processId );
		if ( ! managedProcess ) {
			throw new Error( `Process with id ${ processId } not found` );
		}
		if ( managedProcess.status !== 'online' ) {
			throw new Error( `Process with id ${ processId } is not online` );
		}

		await managedProcess.sendMessage( message );
	}

	private async broadcastEvent( event: DaemonEvent ): Promise< void > {
		this.eventsServer.broadcast( event );
	}

	private async broadcastProcessEvent(
		managedProcess: ManagedProcess,
		event: ManagedProcessEvent
	): Promise< void > {
		await this.broadcastEvent( {
			type: 'process-event',
			payload: {
				process: { name: managedProcess.name, pm_id: managedProcess.pmId },
				event: event.event,
				...( event.stderrTail ? { stderrTail: event.stderrTail } : {} ),
			},
		} );
	}

	private async broadcastProcessMessage(
		managedProcess: ManagedProcess,
		raw: unknown
	): Promise< void > {
		const event = daemonEventSchema.safeParse( {
			type: 'process-message',
			payload: {
				process: { name: managedProcess.name, pm_id: managedProcess.pmId },
				raw,
			},
		} );

		if ( event.success ) {
			await this.broadcastEvent( event.data );
		}
	}

	private forceCleanupChildren() {
		for ( const managedProcess of this.managedProcesses.values() ) {
			if ( managedProcess.status !== 'online' ) {
				continue;
			}
			void managedProcess.forceStop();
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
					managedProcess.stop()
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
