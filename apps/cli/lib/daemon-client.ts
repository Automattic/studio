import { spawn } from 'child_process';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { LOCKFILE_WAIT_TIME, PROXY_PROCESS_NAME } from '@studio/common/constants';
import { readConfig } from '@studio/common/lib/config/store';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { __, sprintf } from '@wordpress/i18n';
import semver from 'semver';
import { z } from 'zod';
import {
	PROCESS_MANAGER_EVENTS_SOCKET_PATH,
	PROCESS_MANAGER_CONTROL_SOCKET_PATH,
	PROCESS_MANAGER_HOME,
	WINDOWS_PIPE_PREFIX,
} from 'cli/lib/paths';
import { SocketStreamClient, SocketMessageDecoder, SocketRequestClient } from 'cli/lib/socket';
import {
	ProcessDescription,
	DaemonRequest,
	SITE_PROCESS_PREFIX,
	daemonEventSchema,
	daemonPingResponseSchema,
	daemonResponseSchema,
	processDescriptionSchema,
	processEventSchema,
} from 'cli/lib/types/process-manager-ipc';
import {
	ManagerMessage,
	childMessageFromProcessManagerSchema,
} from 'cli/lib/types/wordpress-server-ipc';
import type { SocketEvent } from '@studio/common/lib/cli-events';

const CONNECTION_TIMEOUT_MS = 10_000;
const PROCESS_MANAGER_LOCKFILE_PATH = path.join( PROCESS_MANAGER_HOME, 'pm-connection.lock' );
const EVENTS_SOCKET_DIR = process.platform === 'win32' ? '\\\\.\\pipe\\' : PROCESS_MANAGER_HOME;
const EVENTS_SOCKET_PREFIX = process.platform === 'win32' ? WINDOWS_PIPE_PREFIX : '';

function eventsSocketPath( name: string ): string {
	return path.join( EVENTS_SOCKET_DIR, `${ EVENTS_SOCKET_PREFIX }${ name }.sock` );
}

// One events socket per kind of Studio app, each owned by that app's `_events`. The
// desktop keeps the original path, which older desktop builds also listen on.
export const EVENTS_SOCKET_PATHS = {
	desktop: eventsSocketPath( 'events' ),
	ui: eventsSocketPath( 'events-ui' ),
	remote: eventsSocketPath( 'events-remote' ),
} as const;

// `studio mcp` runs once per agent session, so each process gets its own events
// socket, named after the pid of the `_events` command that owns it.
const MCP_EVENTS_SOCKET = new RegExp( `^${ EVENTS_SOCKET_PREFIX }events-mcp-(\\d+)\\.sock$` );

export function mcpEventsSocketPath( pid = process.pid ): string {
	return eventsSocketPath( `events-mcp-${ pid }` );
}

export function isProcessAlive( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch {
		return false;
	}
}

// Also removes the sockets dead processes left behind; named pipes go away with their process.
function liveMcpEventsSocketPaths(): string[] {
	let entries: string[];
	try {
		entries = fs.readdirSync( EVENTS_SOCKET_DIR );
	} catch {
		return [];
	}
	return entries.flatMap( ( entry ) => {
		const pid = Number( MCP_EVENTS_SOCKET.exec( entry )?.[ 1 ] );
		if ( ! pid ) {
			return [];
		}
		if ( isProcessAlive( pid ) ) {
			return [ mcpEventsSocketPath( pid ) ];
		}
		if ( process.platform !== 'win32' ) {
			fs.rmSync( mcpEventsSocketPath( pid ), { force: true } );
		}
		return [];
	} );
}

export type EventsListener = keyof typeof EVENTS_SOCKET_PATHS | 'mcp';

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

const daemonListProcessesSuccessResponseSchema = z.object( {
	processes: z.array( processDescriptionSchema ),
} );

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

async function pingDaemon(): Promise< string | undefined > {
	const response = daemonPingResponseSchema.safeParse(
		await sendDaemonRequest( { type: 'ping' } )
	);
	return response.success ? response.data.version : undefined;
}

async function waitFor( isDone: () => Promise< boolean >, timeoutMessage: string ) {
	const start = Date.now();
	while ( Date.now() - start < CONNECTION_TIMEOUT_MS ) {
		if ( await isDone() ) {
			return;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );
	}
	throw new Error( timeoutMessage );
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

async function startDaemon() {
	spawnDaemonProcess();
	await waitFor(
		() =>
			pingDaemon().then(
				() => true,
				() => false
			),
		`Daemon connection timeout after ${ CONNECTION_TIMEOUT_MS / 1000 } seconds`
	);
}

function isRecoverableConnectError( error: unknown ) {
	return (
		isErrnoException( error ) &&
		( error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'EPIPE' )
	);
}

/**
 * Whether a client should replace a daemon started by another version of the CLI. Only an older
 * daemon is replaced, so a Desktop app and an npm CLI of different versions don't keep replacing
 * each other's. Daemons that predate versioned pings report no version and count as older.
 */
export function isDaemonOutdated( daemonVersion: string | undefined, clientVersion: string ) {
	if ( ! semver.valid( clientVersion ) ) {
		return false;
	}
	if ( daemonVersion === undefined ) {
		return true;
	}
	return semver.valid( daemonVersion ) !== null && semver.lt( daemonVersion, clientVersion );
}

// The sites a replaced daemon was running, kept on disk until they're started again, so a client
// interrupted halfway through leaves them to the next one.
const SITES_TO_RESTART_PATH = path.join( PROCESS_MANAGER_HOME, 'sites-to-restart.json' );
const sitesToRestartSchema = z.object( {
	pid: z.number(),
	processNames: z.array( z.string() ),
} );

function writeSitesToRestart( processNames: string[] ) {
	fs.writeFileSync( SITES_TO_RESTART_PATH, JSON.stringify( { pid: process.pid, processNames } ) );
}

function readSitesToRestart() {
	try {
		return sitesToRestartSchema.parse(
			JSON.parse( fs.readFileSync( SITES_TO_RESTART_PATH, 'utf8' ) )
		);
	} catch {
		return undefined;
	}
}

// Takes over the sites a client left to restart when it exited before finishing.
function claimSitesToRestart(): string[] {
	const pending = readSitesToRestart();
	if ( ! pending || isProcessAlive( pending.pid ) ) {
		return [];
	}
	writeSitesToRestart( pending.processNames );
	return pending.processNames;
}

/**
 * Stops an outdated daemon, with the processes it supervises, and starts this CLI's. Returns the
 * names of the processes that were running, so their sites can be started again.
 */
async function replaceDaemon(): Promise< string[] > {
	const { processes } = daemonListProcessesSuccessResponseSchema.parse(
		await sendDaemonRequest( { type: 'list-processes' } )
	);
	const processNames = processes.filter( ( p ) => p.status === 'online' ).map( ( p ) => p.name );
	writeSitesToRestart( processNames );
	await sendDaemonRequest( { type: 'kill-daemon' } );
	await waitFor(
		() =>
			pingDaemon().then(
				() => false,
				( error ) => isRecoverableConnectError( error )
			),
		'The outdated process daemon did not stop'
	);
	await startDaemon();
	return processNames;
}

async function ensureDaemonIsRunning(): Promise< string[] > {
	let daemonVersion: string | undefined;
	try {
		daemonVersion = await pingDaemon();
	} catch ( error ) {
		if ( ! isRecoverableConnectError( error ) ) {
			throw error;
		}
		await startDaemon();
		return [];
	}

	if ( ! isDaemonOutdated( daemonVersion, __STUDIO_CLI_VERSION__ ) ) {
		return [];
	}
	return replaceDaemon();
}

function runSiteStart( sitePath: string ): Promise< boolean > {
	const cliPath = path.resolve( import.meta.dirname, 'main.mjs' );
	return new Promise( ( resolve ) => {
		const child = spawn(
			process.execPath,
			[ cliPath, 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
			{ stdio: 'ignore', windowsHide: true }
		);
		child.once( 'error', () => resolve( false ) );
		child.once( 'exit', ( code ) => resolve( code === 0 ) );
	} );
}

/**
 * Starts the sites the replaced daemon was running, through this CLI's `site start`. A site this
 * process holds an operation on is left to that operation, and one whose folder is gone stays
 * stopped: starting it would recreate part of the folder.
 */
async function restartSites( processNames: string[] ) {
	const { sites } = await readConfig();
	const sitesToStart = sites.filter(
		( site ) =>
			processNames.includes( `${ SITE_PROCESS_PREFIX }${ site.id }` ) &&
			site.operation?.pid !== process.pid &&
			fs.existsSync( site.path )
	);
	// A start can fail because another process, like the Desktop app starting its sites at launch,
	// holds an operation on the site. That site is left to that process.
	const isHandledElsewhere = async ( siteId: string ) => {
		const site = ( await readConfig() ).sites.find( ( { id } ) => id === siteId );
		return (
			( site?.operation !== undefined && isProcessAlive( site.operation.pid ) ) ||
			( await isProcessRunning( `${ SITE_PROCESS_PREFIX }${ siteId }` ) ) !== undefined
		);
	};
	await Promise.all(
		sitesToStart.map( async ( site ) => {
			if ( ! ( await runSiteStart( site.path ) ) && ! ( await isHandledElsewhere( site.id ) ) ) {
				console.error(
					sprintf(
						// translators: %s: site name.
						__( 'Studio was updated, and the site "%s" could not be started again.' ),
						site.name
					)
				);
			}
		} )
	);
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
	await lockFileAsync( PROCESS_MANAGER_LOCKFILE_PATH, { wait: LOCKFILE_WAIT_TIME } );

	let processesToRestart: string[];
	try {
		// Replaced inside the lock, so concurrent clients wait for one replacement instead of
		// starting their own.
		processesToRestart = await ensureDaemonIsRunning();
		if ( ! processesToRestart.length ) {
			processesToRestart = claimSitesToRestart();
		}
		await ensureDaemonBus();
		isConnected = true;
	} catch ( error ) {
		await cleanupDaemonBus();
		throw error;
	} finally {
		await unlockFileAsync( PROCESS_MANAGER_LOCKFILE_PATH );
	}

	// After unlocking: each `site start` connects to the daemon itself.
	if ( processesToRestart.length ) {
		await restartSites( processesToRestart );
	}
	if ( readSitesToRestart()?.pid === process.pid ) {
		fs.rmSync( SITES_TO_RESTART_PATH, { force: true } );
	}
}

export async function disconnectFromDaemon(): Promise< void > {
	isConnected = false;
	await cleanupDaemonBus();
}

export async function killDaemonAndChildren() {
	await sendDaemonRequest( { type: 'kill-daemon' } );
}

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
		// For daemons left running from older Studio versions; see the request schema.
		runtime: 'native-php',
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

const eventsSocketClients = Object.values( EVENTS_SOCKET_PATHS ).map(
	( socketPath ) => new SocketRequestClient( socketPath )
);

/**
 * Emit a CLI event to every Studio app's `_events` command. Apps that aren't running are skipped.
 */
export async function emitCliEvent( payload: SocketEvent ): Promise< void > {
	const mcpClients = liveMcpEventsSocketPaths().map(
		( socketPath ) => new SocketRequestClient( socketPath )
	);
	await Promise.all(
		[ ...eventsSocketClients, ...mcpClients ].map( ( client ) =>
			client.send( payload ).catch( () => undefined )
		)
	);
}
