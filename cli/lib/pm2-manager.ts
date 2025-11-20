import fs from 'fs';
import os from 'os';
import path from 'path';
import { StartOptions } from 'pm2';
import { getAppdataPath } from 'cli/lib/appdata';
import { ProcessDescription } from 'cli/lib/types/pm2';

const PM2_STATUS_ONLINE = 'online';
const PROXY_PROCESS_NAME = 'studio-proxy';
const DAEMON_TIMEOUT = 10000;

// Set consistent PM2 home directory for Studio CLI
// This ensures all Studio CLI commands use the same PM2 daemon
const STUDIO_PM2_HOME = path.join( os.homedir(), '.studio', 'pm2' );

process.env.PM2_HOME = STUDIO_PM2_HOME;

function resolvePm2(): typeof import('pm2') {
	try {
		return require( 'pm2' );
	} catch ( error ) {
		const possiblePaths: string[] = [
			path.join( __dirname, 'node_modules', 'pm2' ),
			path.join( path.dirname( __dirname ), 'node_modules', 'pm2' ),
			path.join( __dirname, '..', 'node_modules', 'pm2' ),
			path.join( __dirname, '..', '..', 'node_modules', 'pm2' ),
			path.join( __dirname, '..', '..', '..', 'node_modules', 'pm2' ),
			path.resolve( process.cwd(), 'node_modules', 'pm2' ),
		];

		for ( const pm2Path of possiblePaths ) {
			if ( fs.existsSync( pm2Path ) ) {
				try {
					return require( pm2Path );
				} catch {
					continue;
				}
			}
		}

		throw new Error(
			`pm2 module not found. Please ensure pm2 is installed in the CLI dependencies. Tried paths: ${ possiblePaths.join(
				', '
			) }`
		);
	}
}

const pm2 = resolvePm2();

let isConnected = false;

export function getPm2Instance() {
	return pm2;
}

export function disconnect(): void {
	if ( isConnected ) {
		pm2.disconnect();
		isConnected = false;
	}
}

async function connect(): Promise< void > {
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

export async function startDaemon(): Promise< void > {
	await connect();
}

async function listProcesses(): Promise< ProcessDescription[] > {
	return new Promise( ( resolve, reject ) => {
		pm2.list( ( error, processes ) => {
			if ( error ) {
				reject( error );
				return;
			}

			const processDescriptions = ( processes || [] ).map( ( p ) => ( {
				name: p.name || '',
				pmId: p.pm_id || -1,
				status: p.pm2_env?.status || 'unknown',
			} ) );

			resolve( processDescriptions );
		} );
	} );
}

function cleanup(): void {
	disconnect();
}

process.on( 'exit', cleanup );
process.on( 'SIGINT', cleanup );
process.on( 'SIGTERM', cleanup );

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

export async function isProxyProcessRunning(): Promise< boolean > {
	return isProcessRunning( PROXY_PROCESS_NAME );
}

export async function isProcessRunning( processName: string ): Promise< boolean > {
	try {
		if ( ! isConnected ) {
			return false;
		}

		const processes = await listProcesses();
		return processes.some( ( p ) => p.name === processName && p.status === PM2_STATUS_ONLINE );
	} catch ( error ) {
		console.error( `Error checking if process ${ processName } is running:`, error );
		return false;
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
			autorestart: true,
			max_restarts: 5,
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
				};
				const pm2Env = app.pm2_env;

				if ( pm2Env && pm2Env.pm_id !== undefined && pm2Env.status ) {
					resolve( {
						name: processName,
						pmId: pm2Env.pm_id,
						status: pm2Env.status,
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
