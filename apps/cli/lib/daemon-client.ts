import { spawn } from 'child_process';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { z } from 'zod';
import {
	PROCESS_MANAGER_EVENTS_SOCKET_PATH,
	PROCESS_MANAGER_CONTROL_SOCKET_PATH,
	PROCESS_MANAGER_HOME,
	daemonPipePath,
} from 'cli/lib/paths';
import { SocketStreamClient, SocketMessageDecoder, SocketRequestClient } from 'cli/lib/socket';
import {
	ProcessDescription,
	DaemonRequest,
	daemonEventSchema,
	daemonResponseSchema,
	processDescriptionSchema,
	processEventSchema,
} from 'cli/lib/types/process-manager-ipc';
import {
	ManagerMessage,
	childMessageFromProcessManagerSchema,
} from 'cli/lib/types/wordpress-server-ipc';
import type { SocketEvent } from '@studio/common/lib/cli-events';
import type { SiteRuntime } from '@studio/common/lib/site-runtime';

const PROXY_PROCESS_NAME = 'studio-proxy';
const CONNECTION_TIMEOUT_MS = 10_000;
const PROCESS_MANAGER_LOCKFILE_PATH = path.join( PROCESS_MANAGER_HOME, 'pm-connection.lock' );
export const SITE_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? daemonPipePath( 'studio-events' )
		: path.join( PROCESS_MANAGER_HOME, 'events.sock' );

function ensureProcessManagerHome() {
	if ( ! fs.existsSync( PROCESS_MANAGER_HOME ) ) {
		fs.mkdirSync( PROCESS_MANAGER_HOME, { recursive: true } );
	}
}

export type DaemonBusEventMap = {
	'process-message': z.infer< typeof childMessageFromProcessManagerSchema >;
	'process-event': z.infer< typeof processEventSchema >;
	'daemon-kill': { reason?: string };
};

class DaemonBusEventEmitter extends EventEmitter {
	on< K extends keyof DaemonBusEventMap >(
		event: K,
		listener: ( payload: DaemonBusEventMap[ K ] ) => void
	): this {
		return super.on( event, listener );
	}

	emit< K extends keyof DaemonBusEventMap >( event: K, payload: DaemonBusEventMap[ K ] ): boolean {
		return super.emit( event, payload );
	}
}

export class DaemonBus extends DaemonBusEventEmitter {
	private readonly socketClient: SocketStreamClient;
	private decoder = new SocketMessageDecoder();

	constructor( endpoint: string ) {
		super();
		this.socketClient = new SocketStreamClient( endpoint, 2500 );
		this.socketClient.on( 'data', ( { chunk } ) => {
			try {
				for ( const packet of this.decoder.write( chunk ) ) {
					this.handlePacket( packet );
				}
			} catch {
				this.decoder = new SocketMessageDecoder();
			}
		} );
		this.socketClient.on( 'close', () => {
			this.decoder = new SocketMessageDecoder();
		} );
	}

	isConnected(): boolean {
		return this.socketClient.isConnected();
	}

	private handlePacket( packet: unknown ) {
		const result = daemonEventSchema.safeParse( packet );
		if ( ! result.success ) {
			return;
		}

		switch ( result.data.type ) {
			case 'process-message':
				this.emit( 'process-message', result.data.payload );
				return;
			case 'process-event':
				this.emit( 'process-event', result.data.payload );
				return;
			case 'daemon-kill':
				this.emit( 'daemon-kill', result.data.payload );
				return;
		}
	}

	async connect(): Promise< void > {
		await this.socketClient.connect();
	}

	async close(): Promise< void > {
		await this.socketClient.close();
	}
}

async function sendDaemonRequest( request: DaemonRequest ): Promise< unknown > {
	const socketClient = new SocketRequestClient(
		PROCESS_MANAGER_CONTROL_SOCKET_PATH,
		CONNECTION_TIMEOUT_MS
	);
	const rawResponse = await socketClient.sendAndWaitForResponse( {
		...request,
		requestId: crypto.randomUUID(),
	} );

	const response = daemonResponseSchema.parse( rawResponse );

	if ( response.type === 'error' ) {
		throw new Error( response.error.message );
	}

	return response.payload;
}

async function waitForDaemonReady() {
	const start = Date.now();
	let lastError: unknown;

	while ( Date.now() - start < CONNECTION_TIMEOUT_MS ) {
		try {
			await sendDaemonRequest( { type: 'ping' } );
			return;
		} catch ( error ) {
			lastError = error;
			await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );
		}
	}

	if ( lastError instanceof Error ) {
		throw lastError;
	}

	throw new Error( `Daemon connection timeout after ${ CONNECTION_TIMEOUT_MS / 1000 } seconds` );
}

function spawnDaemonProcess() {
	const daemonScriptPath = path.resolve( import.meta.dirname, 'process-manager-daemon.mjs' );
	const daemonProcess = spawn( process.execPath, [ daemonScriptPath ], {
		detached: true,
		stdio: 'ignore',
		windowsHide: true,
	} );
	daemonProcess.unref();
}

function isRecoverableConnectError( error: unknown ) {
	return (
		isErrnoException( error ) &&
		( error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'EPIPE' )
	);
}

async function ensureDaemonIsRunning(): Promise< void > {
	try {
		await sendDaemonRequest( { type: 'ping' } );
	} catch ( error ) {
		if ( ! isRecoverableConnectError( error ) ) {
			throw error;
		}

		spawnDaemonProcess();
		await waitForDaemonReady();
		await sendDaemonRequest( { type: 'ping' } );
	}
}

let daemonBus: DaemonBus | null = null;

async function ensureDaemonBus(): Promise< DaemonBus > {
	if ( daemonBus ) {
		if ( ! daemonBus.isConnected() ) {
			await daemonBus.connect();
		}
		return daemonBus;
	}

	const bus = new DaemonBus( PROCESS_MANAGER_EVENTS_SOCKET_PATH );
	await bus.connect();
	daemonBus = bus;
	return bus;
}

async function cleanupDaemonBus() {
	const busToClose = daemonBus;
	daemonBus = null;

	if ( busToClose ) {
		await busToClose.close();
	}
}

let isConnected = false;

export async function connectToDaemon(): Promise< void > {
	if ( isConnected ) {
		return;
	}
	ensureProcessManagerHome();
	await lockFileAsync( PROCESS_MANAGER_LOCKFILE_PATH, {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );

	try {
		await ensureDaemonIsRunning();
		await ensureDaemonBus();
		isConnected = true;
	} catch ( error ) {
		await cleanupDaemonBus();
		throw error;
	} finally {
		await unlockFileAsync( PROCESS_MANAGER_LOCKFILE_PATH );
	}
}

export async function disconnectFromDaemon(): Promise< void > {
	isConnected = false;
	await cleanupDaemonBus();
}

export async function killDaemonAndChildren() {
	await sendDaemonRequest( { type: 'kill-daemon' } );
}

const daemonListProcessesSuccessResponseSchema = z.object( {
	processes: z.array( processDescriptionSchema ),
} );

// Cache the process list returned from the process manager for a very short time to make multiple
// calls in quick succession more efficient
export async function listProcesses() {
	await connectToDaemon();
	const response = await sendDaemonRequest( {
		type: 'list-processes',
	} );
	return daemonListProcessesSuccessResponseSchema.parse( response ).processes;
}

export async function getDaemonBus(): Promise< DaemonBus > {
	if ( ! daemonBus ) {
		throw new Error( 'Daemon bus is not initialized' );
	}
	return daemonBus;
}

export async function sendMessageToProcess(
	processId: number,
	messageToProcess: ManagerMessage
): Promise< void > {
	await sendDaemonRequest( {
		type: 'send-message-to-process',
		processId,
		message: messageToProcess,
	} );
}

export async function startProxyProcess(): Promise< ProcessDescription > {
	const proxyDaemonPath = path.resolve( import.meta.dirname, 'proxy-daemon.mjs' );

	return startProcess( PROXY_PROCESS_NAME, proxyDaemonPath );
}

export async function isProxyProcessRunning(): Promise< ProcessDescription | undefined > {
	return isProcessRunning( PROXY_PROCESS_NAME );
}

export async function stopProxyProcess(): Promise< void > {
	return stopProcess( PROXY_PROCESS_NAME );
}

export async function isProcessRunning(
	processName: string
): Promise< ProcessDescription | undefined > {
	try {
		const processes = await listProcesses();
		return processes.find( ( p ) => p.name === processName && p.status === 'online' );
	} catch ( error ) {
		if ( ! isRecoverableConnectError( error ) ) {
			console.error( `Error checking if process ${ processName } is running:`, error );
		}
		return undefined;
	}
}

const daemonStartProcessSuccessResponseSchema = z.object( {
	process: processDescriptionSchema,
} );

type StartProcessOptions = {
	env?: NodeJS.ProcessEnv;
	args?: string[];
	runtime?: SiteRuntime;
};

export async function startProcess(
	processName: string,
	scriptPath: string,
	options: StartProcessOptions = {}
): Promise< ProcessDescription > {
	const response = await sendDaemonRequest( {
		type: 'start-process',
		processName,
		scriptPath,
		env: options.env ?? process.env,
		args: options.args ?? [],
		runtime: options.runtime,
	} );
	return daemonStartProcessSuccessResponseSchema.parse( response ).process;
}

export async function stopProcess( processName: string ): Promise< void > {
	const runningProcess = await isProcessRunning( processName );

	if ( ! runningProcess ) {
		return;
	}

	await connectToDaemon();
	await sendDaemonRequest( {
		type: 'stop-process',
		processName,
	} );
}

const eventsSocketClient = new SocketRequestClient( SITE_EVENTS_SOCKET_PATH );

/**
 * Emit a CLI event via the events socket, for the `_events` command server to receive.
 */
export async function emitCliEvent( payload: SocketEvent ): Promise< void > {
	try {
		await eventsSocketClient.send( payload );
	} catch {
		// Do nothing
	}
}
