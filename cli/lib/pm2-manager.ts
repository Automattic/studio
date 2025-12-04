import os from 'os';
import path from 'path';
import { cacheFunctionTTL } from 'common/lib/cache-function-ttl';
import { custom as PM2, StartOptions } from 'pm2';
import { getAppdataPath } from 'cli/lib/appdata';
import { ProcessDescription } from 'cli/lib/types/pm2';
import { ManagerMessage } from './types/wordpress-server-ipc';

const PM2_STATUS_ONLINE = 'online';
const PROXY_PROCESS_NAME = 'studio-proxy';
const DAEMON_TIMEOUT = 10000;

// Set consistent PM2 home directory for Studio CLI
// This ensures all Studio CLI commands use the same PM2 daemon
const STUDIO_PM2_HOME = path.join( os.homedir(), '.studio', 'pm2' );

const pm2 = new PM2( { pm2_home: STUDIO_PM2_HOME } );

let isConnected = false;

export async function connect(): Promise< void > {
	if ( isConnected ) {
		return;
	}

	return new Promise( ( resolve, reject ) => {
		const timeout = setTimeout( () => {
			reject(
				new Error(
					'PM2 connection timeout after 10 seconds. Try running: PM2_HOME=~/.studio/pm2 pm2 update'
				)
			);
		}, DAEMON_TIMEOUT );

		pm2.connect( ( error ) => {
			clearTimeout( timeout );
			if ( error ) {
				reject( error );
				return;
			}
			isConnected = true;
			resolve();
		} );
	} );
}

export function disconnect(): void {
	if ( isConnected ) {
		pm2.disconnect();
		isConnected = false;
	}
}

process.on( 'exit', disconnect );
process.on( 'SIGINT', disconnect );
process.on( 'SIGTERM', disconnect );

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
		STUDIO_USER_HOME: os.homedir(),
		STUDIO_APPDATA_PATH: getAppdataPath(),
	};

	if ( process.env.ELECTRON_RUN_AS_NODE ) {
		env.ELECTRON_RUN_AS_NODE = '1';
	}

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
	env?: Record< string, string >
): Promise< ProcessDescription > {
	return new Promise( ( resolve, reject ) => {
		const processConfig: StartOptions = {
			name: processName,
			interpreter: process.execPath,
			script: scriptPath,
			exec_mode: 'fork',
			autorestart: false,
			env: env || {},
		};

		pm2.start( processConfig, async ( error, apps ) => {
			if ( error ) {
				reject( error );
				return;
			}

			if ( apps && apps.length > 0 ) {
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
