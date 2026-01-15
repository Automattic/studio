import os from 'os';
import path from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from 'common/constants';
import { cacheFunctionTTL } from 'common/lib/cache-function-ttl';
import { lockFileAsync, unlockFileAsync } from 'common/lib/lockfile';
import { SITE_EVENTS } from 'common/lib/site-events';
import { custom as PM2, StartOptions } from 'pm2';
import axon from 'pm2-axon';
import { getAppdataPath } from 'cli/lib/appdata';
import { ProcessDescription } from 'cli/lib/types/pm2';
import {
	ManagerMessage,
	pm2ProcessEventSchema,
	childMessagePm2Schema,
} from './types/wordpress-server-ipc';

const PM2_STATUS_ONLINE = 'online';
const PROXY_PROCESS_NAME = 'studio-proxy';
const CONNECTION_TIMEOUT = 10_000;
const KILL_TIMEOUT = 25_000;

// Set consistent PM2 home directory for Studio CLI
// This ensures all Studio CLI commands use the same PM2 daemon
const STUDIO_PM2_HOME = path.join( os.homedir(), '.studio', 'pm2' );
const PM2_LOCKFILE_PATH = path.join( STUDIO_PM2_HOME, 'pm2-connection.lock' );
export const EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\studio-events.sock'
		: path.join( STUDIO_PM2_HOME, 'events.sock' );

export interface ProcessEventData {
	processName: string;
	event: string;
}

const pm2 = new PM2( { pm2_home: STUDIO_PM2_HOME } );

let isConnected = false;

export async function connect(): Promise< void > {
	if ( isConnected ) {
		return;
	}

	await lockFileAsync( PM2_LOCKFILE_PATH, {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );

	return new Promise< void >( ( resolve, reject ) => {
		const timeout = setTimeout( () => {
			reject(
				new Error(
					'PM2 connection timeout after 10 seconds. Try running: PM2_HOME=~/.studio/pm2 pm2 update'
				)
			);
		}, CONNECTION_TIMEOUT );

		pm2.connect( ( error ) => {
			clearTimeout( timeout );
			if ( error ) {
				reject( error );
				return;
			}
			isConnected = true;
			resolve();
		} );
	} ).finally( () => {
		return unlockFileAsync( PM2_LOCKFILE_PATH );
	} );
}

export async function disconnect(): Promise< void > {
	if ( ! isConnected ) {
		return;
	}

	return new Promise< void >( ( resolve, reject ) => {
		const timeout = setTimeout( () => {
			reject( new Error( 'Timeout after 10 seconds trying to disconnect from PM2' ) );
		}, CONNECTION_TIMEOUT );

		pm2.disconnect( ( error ) => {
			clearTimeout( timeout );
			if ( error ) {
				reject( error );
				return;
			}
			isConnected = false;
			resolve();
		} );
	} );
}

export async function killDaemonAndAllChildren() {
	return new Promise< void >( ( resolve, reject ) => {
		const timeout = setTimeout( () => {
			reject(
				new Error(
					'PM2 kill timeout after 25 seconds. Try running: PM2_HOME=~/.studio/pm2 pm2 kill'
				)
			);
		}, KILL_TIMEOUT );

		pm2.killDaemon( ( error ) => {
			clearTimeout( timeout );
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

// Cache the return value of `pm2.list` for a very short time to make multiple calls in quick
// succession more efficient
const listProcesses = cacheFunctionTTL( () => {
	return new Promise< ProcessDescription[] >( ( resolve, reject ) => {
		pm2.list( ( error, processes ) => {
			if ( error ) {
				reject( error );
				return;
			}

			const processDescriptions = ( processes || [] ).map( ( p ) => ( {
				name: p.name || '',
				pmId: p.pm_id ?? -1,
				status: p.pm2_env?.status || 'unknown',
				pid: p.pid,
			} ) );

			resolve( processDescriptions );
		} );
	} );
} );

// PM2 bus for inter-process communication
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pm2Bus: any = null;

export async function getPm2Bus() {
	if ( pm2Bus ) {
		return pm2Bus;
	}

	return new Promise( ( resolve, reject ) => {
		pm2.launchBus( ( error, bus ) => {
			if ( error ) {
				reject( error );
				return;
			}
			pm2Bus = bus;
			resolve( bus );
		} );
	} );
}

export function sendMessageToProcess(
	processId: number,
	pm2Message: ManagerMessage
): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		pm2.sendDataToProcessId( processId, pm2Message, ( error ) => {
			if ( error ) {
				reject( error );
			} else {
				resolve();
			}
		} );
	} );
}

export async function startProxyProcess(): Promise< ProcessDescription > {
	const proxyDaemonPath = path.resolve( __dirname, 'proxy-daemon.js' );
	const env: Record< string, string > = {
		ELECTRON_RUN_AS_NODE: '1',
		STUDIO_USER_HOME: os.homedir(),
		STUDIO_APPDATA_PATH: getAppdataPath(),
	};

	return startProcess( PROXY_PROCESS_NAME, proxyDaemonPath, env );
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

export async function startProcess(
	processName: string,
	scriptPath: string,
	env: Record< string, string > = {},
	args: string[] = []
): Promise< ProcessDescription > {
	return new Promise( ( resolve, reject ) => {
		const processConfig: StartOptions = {
			name: processName,
			interpreter: process.execPath,
			script: scriptPath,
			exec_mode: 'fork',
			autorestart: false,
			args,
			// Merge process.env with custom env to ensure child processes inherit
			// necessary environment variables (PATH, HOME, E2E vars, etc.)
			env: { ...process.env, ...env } as Record< string, string >,
		};

		pm2.start( processConfig, async ( error, apps ) => {
			if ( error ) {
				reject( error );
				return;
			}

			if ( apps.length > 0 ) {
				const app = apps[ 0 ] as ( typeof apps )[ 0 ] & {
					pm2_env?: { pm_id?: number; status?: string };
					pid?: number;
				};
				const pm2Env = app.pm2_env;

				if ( pm2Env && pm2Env.pm_id !== undefined && pm2Env.status ) {
					resolve( {
						name: processName,
						pmId: pm2Env.pm_id,
						status: pm2Env.status,
						pid: app.pid,
					} );
					return;
				}
			}

			reject(
				new Error( `Failed to start process ${ processName }: PM2 returned incomplete response` )
			);
		} );
	} );
}

export async function stopProcess( processName: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		pm2.delete( processName, ( error ) => {
			if ( error ) {
				if ( error.message.includes( 'process name not found' ) ) {
					resolve();
					return;
				}
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

/**
 * Subscribe to PM2 process events (online, exit, stop, restart)
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

export interface ProcessMessageData {
	processName: string;
	pmId: number;
	topic: string;
	data?: unknown;
}

/**
 * Subscribe to PM2 process messages (IPC messages from child processes)
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

/**
 * Emit a site event via the events socket, for the `_events` command server to receive.
 *
 * @param event - The event topic (e.g., 'site-created', 'site-updated', 'site-deleted')
 * @param data - The event data (must include siteId)
 */
export async function emitSiteEvent(
	event: SITE_EVENTS,
	data: { siteId: string; url?: string }
): Promise< void > {
	const socket = axon.socket( 'push' );
	socket.connect( EVENTS_SOCKET_PATH );

	const closeHandler = () => socket.close();
	process.on( 'SIGINT', closeHandler );
	process.on( 'SIGTERM', closeHandler );

	await new Promise< void >( ( resolve ) => {
		socket.once( 'connect', function () {
			socket.send( { event, data } );
			resolve();
		} );
	} ).finally( closeHandler );
}
