import fs from 'fs';
import os from 'os';
import path from 'path';
import { StartOptions } from 'pm2';
import { getAppdataPath } from 'cli/lib/appdata';

const PM2_STATUS_ONLINE = 'online';
const PROXY_PROCESS_NAME = 'studio-proxy';
// Set consistent PM2 home directory for Studio CLI
// This ensures all Studio CLI commands use the same PM2 daemon
const STUDIO_PM2_HOME = path.join( os.homedir(), '.studio', 'pm2' );

process.env.PM2_HOME = STUDIO_PM2_HOME;

interface ProcessDescription {
	name: string;
	pmId: number;
	status: string;
}

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
		pm2.connect( ( error ) => {
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
	// Keep connection open - subsequent operations will reuse it
	// The isConnected flag prevents duplicate connections
}

async function listProcesses(): Promise< ProcessDescription[] > {
	return new Promise( ( resolve, reject ) => {
		pm2.list( ( error, processes ) => {
			if ( error ) {
				reject( error );
				return;
			}
			resolve( ( processes || [] ) as ProcessDescription[] );
		} );
	} );
}

function cleanup(): void {
	disconnect();
}

process.on( 'exit', cleanup );
process.on( 'SIGINT', cleanup );
process.on( 'SIGTERM', cleanup );

function getProxyProcessEnv() {
	const env: Record< string, string > = {
		STUDIO_USER_HOME: os.homedir(),
		STUDIO_APPDATA_PATH: getAppdataPath(),
	};

	if ( process.env.ELECTRON_RUN_AS_NODE ) {
		env.ELECTRON_RUN_AS_NODE = '1';
	}

	return env;
}

/**
 * Start the proxy server via PM2
 * This launches the proxy-daemon.js script which runs the proxy servers
 */
export async function startProxyProcess(): Promise< ProcessDescription > {
	const proxyDaemonPath = path.resolve( __dirname, 'proxy-daemon.js' );
	return new Promise( ( resolve, reject ) => {
		const processConfig: StartOptions = {
			name: PROXY_PROCESS_NAME,
			interpreter: process.execPath,
			script: proxyDaemonPath,
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 5,
			env: getProxyProcessEnv(),
		};

		pm2.start( processConfig, ( error, apps ) => {
			if ( error ) {
				reject( error );
				return;
			}

			if ( ! apps.length ) {
				reject( new Error( 'Failed to start proxy process' ) );
				return;
			}

			resolve( {
				name: apps[ 0 ].name,
				pmId: apps[ 0 ].pm_id,
				status: apps[ 0 ].status,
			} );
		} );
	} );
}

/**
 * Check if the proxy process is running
 */
export async function isProxyProcessRunning(): Promise< boolean > {
	try {
		if ( ! isConnected ) {
			return false;
		}

		const processes = await listProcesses();
		return processes.some(
			( p ) => p.name === PROXY_PROCESS_NAME && p.status === PM2_STATUS_ONLINE
		);
	} catch ( error ) {
		console.error( 'Error checking if proxy is running:', error );
		return false;
	}
}
