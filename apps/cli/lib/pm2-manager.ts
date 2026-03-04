import { spawn } from 'child_process';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { cacheFunctionTTL } from '@studio/common/lib/cache-function-ttl';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { SITE_EVENTS } from '@studio/common/lib/site-events';
import { z } from 'zod';
import {
	PROCESS_MANAGER_EVENTS_SOCKET_PATH,
	PROCESS_MANAGER_CONTROL_SOCKET_PATH,
	PROCESS_MANAGER_HOME,
} from 'cli/lib/process-manager';
import { SocketClient, SocketMessageDecoder } from 'cli/lib/socket';
import { ProcessDescription } from 'cli/lib/types/pm2';
import {
	DaemonRequestWithoutRequestId,
	daemonEventSchema,
	daemonResponseSchema,
	processDescriptionSchema,
} from 'cli/lib/types/process-manager-ipc';
import {
	ManagerMessage,
	childMessagePm2Schema,
	pm2ProcessEventSchema,
} from 'cli/lib/types/wordpress-server-ipc';

const PM2_STATUS_ONLINE = 'online';
const PROXY_PROCESS_NAME = 'studio-proxy';
const CONNECTION_TIMEOUT = 10_000;
const PM2_LOCKFILE_PATH = path.join( PROCESS_MANAGER_HOME, 'pm2-connection.lock' );
export const SITE_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\studio-events.sock'
		: path.join( PROCESS_MANAGER_HOME, 'events.sock' );

if ( process.platform !== 'win32' && ! fs.existsSync( PROCESS_MANAGER_HOME ) ) {
	fs.mkdirSync( PROCESS_MANAGER_HOME, { recursive: true } );
}

export interface ProcessEventData {
	processName: string;
	event: string;
}

let isConnected = false;
let pm2Bus: DaemonBus | null = null;

function isRecoverableConnectError( error: unknown ) {
	return (
		isErrnoException( error ) &&
		( error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'EPIPE' )
	);
}

class DaemonBus extends EventEmitter {
	private readonly socketClient: SocketClient;
	private socket: net.Socket | null = null;
	private readonly decoder = new SocketMessageDecoder();

	constructor( endpoint: string ) {
		super();
		this.socketClient = new SocketClient( endpoint, 2500 );
	}

	private handlePacket( packet: unknown ) {
		const result = daemonEventSchema.safeParse( packet );
		if ( ! result.success ) {
			return;
		}

		switch ( result.data.type ) {
			case 'process-message':
				this.emit( 'process:msg', result.data.payload );
				return;
			case 'process-event':
				this.emit( 'process:event', result.data.payload );
				return;
			case 'daemon-kill':
				this.emit( 'pm2:kill', result.data.payload );
				return;
		}
	}

	async connect(): Promise< void > {
		const socket = await this.socketClient.connect();
		this.socket = socket;
		socket.on( 'data', ( chunk ) => {
			try {
				for ( const packet of this.decoder.write( chunk ) ) {
					this.handlePacket( packet );
				}
			} catch {
				socket.destroy();
			}
		} );
		socket.on( 'close', () => {
			this.socket = null;
		} );
	}

	async close(): Promise< void > {
		const socket = this.socket;
		this.socket = null;
		if ( socket && ! socket.destroyed ) {
			await new Promise< void >( ( resolve ) => {
				socket.once( 'close', () => resolve() );
				socket.end();
			} );
		}
	}
}

async function sendDaemonRequest( request: DaemonRequestWithoutRequestId ): Promise< unknown > {
	const socketClient = new SocketClient( PROCESS_MANAGER_CONTROL_SOCKET_PATH, CONNECTION_TIMEOUT );
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

	while ( Date.now() - start < CONNECTION_TIMEOUT ) {
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

	throw new Error( 'Daemon connection timeout after 10 seconds' );
}

function spawnDaemonProcess() {
	const daemonScriptPath = path.resolve( __dirname, 'daemon.js' );
	const daemonProcess = spawn( process.execPath, [ daemonScriptPath, '--avoid-telemetry' ], {
		detached: true,
		stdio: 'ignore',
	} );
	daemonProcess.unref();
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

async function ensurePm2Bus(): Promise< DaemonBus > {
	if ( pm2Bus ) {
		return pm2Bus;
	}

	const bus = new DaemonBus( PROCESS_MANAGER_EVENTS_SOCKET_PATH );
	await bus.connect();
	pm2Bus = bus;
	return bus;
}

async function cleanupPm2Bus() {
	const busToClose = pm2Bus;
	pm2Bus = null;

	if ( busToClose ) {
		await busToClose.close();
	}
}

// `connect()` / `disconnect()` are client-side lifecycle helpers. They prepare and tear down this
// process's local daemon session state; they do not establish daemon-side control-channel state.
export async function connect(): Promise< void > {
	if ( isConnected ) {
		return;
	}
	await lockFileAsync( PM2_LOCKFILE_PATH, {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );

	try {
		await ensureDaemonIsRunning();
		await ensurePm2Bus();
		isConnected = true;
	} catch ( error ) {
		await cleanupPm2Bus();
		throw error;
	} finally {
		await unlockFileAsync( PM2_LOCKFILE_PATH );
	}
}

export async function disconnect(): Promise< void > {
	isConnected = false;
	await cleanupPm2Bus();
}

export async function killDaemonAndChildren() {
	await sendDaemonRequest( { type: 'kill-daemon' } );
}

const daemonListProcessesSuccessResponseSchema = z.object( {
	processes: z.array( processDescriptionSchema ),
} );

// Cache the process list returned from the process manager for a very short time to make multiple
// calls in quick succession more efficient
const listProcesses = cacheFunctionTTL( async () => {
	const response = await sendDaemonRequest( {
		type: 'list-processes',
	} );
	return daemonListProcessesSuccessResponseSchema.parse( response ).processes;
} );

export async function getPm2Bus(): Promise< EventEmitter > {
	if ( ! pm2Bus ) {
		throw new Error( 'Daemon bus is not initialized' );
	}
	return pm2Bus;
}

export async function sendMessageToProcess(
	processId: number,
	pm2Message: ManagerMessage
): Promise< void > {
	await sendDaemonRequest( {
		type: 'send-message-to-process',
		processId,
		message: pm2Message,
	} );
}

export async function startProxyProcess(): Promise< ProcessDescription > {
	const proxyDaemonPath = path.resolve( __dirname, 'proxy-daemon.js' );

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
		if ( ! isConnected ) {
			return undefined;
		}

		const processes = await listProcesses();
		return processes.find( ( p ) => p.name === processName && p.status === PM2_STATUS_ONLINE );
	} catch ( error ) {
		console.error( `Error checking if process ${ processName } is running:`, error );
		return undefined;
	}
}

const daemonStartProcessSuccessResponseSchema = z.object( {
	process: processDescriptionSchema,
} );

export async function startProcess(
	processName: string,
	scriptPath: string,
	env: Record< string, string > = {},
	args: string[] = []
): Promise< ProcessDescription > {
	const response = await sendDaemonRequest( {
		type: 'start-process',
		processName,
		scriptPath,
		env,
		args,
	} );
	return daemonStartProcessSuccessResponseSchema.parse( response ).process;
}

export async function stopProcess( processName: string ): Promise< void > {
	await connect();
	await sendDaemonRequest( {
		type: 'stop-process',
		processName,
	} );
}

/**
 * Subscribe to process manager events (online, exit, stop, restart)
 * @param handler - Callback invoked when a process event occurs
 * @returns Unsubscribe function to stop listening
 */
export async function subscribeProcessEvents(
	handler: ( data: ProcessEventData ) => void
): Promise< () => void > {
	const bus = await getPm2Bus();

	const eventHandler = ( data: unknown ) => {
		const result = pm2ProcessEventSchema.safeParse( data );
		if ( ! result.success ) {
			return;
		}

		handler( {
			processName: result.data.process.name,
			event: result.data.event,
		} );
	};

	bus.on( 'process:event', eventHandler );

	return () => {
		bus.off( 'process:event', eventHandler );
	};
}

type ProcessMessageData = {
	processName: string;
	pmId: number;
	topic: string;
	data?: unknown;
};

/**
 * Subscribe to process manager messages (IPC messages from child processes)
 * @param handler - Callback invoked when a process message is received
 * @returns Unsubscribe function to stop listening
 */
export async function subscribeProcessMessages(
	handler: ( data: ProcessMessageData ) => void
): Promise< () => void > {
	const bus = await getPm2Bus();

	const messageHandler = ( packet: unknown ) => {
		const result = childMessagePm2Schema.safeParse( packet );
		if ( ! result.success ) {
			return;
		}

		handler( {
			processName: result.data.process.name,
			pmId: result.data.process.pm_id,
			topic: result.data.raw.topic,
			data: result.data.raw,
		} );
	};

	bus.on( 'process:msg', messageHandler );

	return () => {
		bus.off( 'process:msg', messageHandler );
	};
}

export async function subscribePm2KillEvent( handler: () => void ) {
	const bus = await getPm2Bus();

	bus.on( 'pm2:kill', handler );

	return () => {
		bus.off( 'pm2:kill', handler );
	};
}

const eventsSocketClient = new SocketClient( SITE_EVENTS_SOCKET_PATH );

/**
 * Emit a site event via the events socket, for the `_events` command server to receive.
 *
 * @param event - The event topic (e.g., 'site-created', 'site-updated', 'site-deleted')
 * @param data - The event data (must include siteId)
 */
export async function emitSiteEvent(
	event: SITE_EVENTS,
	data: { siteId: string }
): Promise< void > {
	try {
		await eventsSocketClient.send( { event, data } );
	} catch {
		// Do nothing
	}
}
