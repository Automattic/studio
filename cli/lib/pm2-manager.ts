import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAppdataPath } from 'cli/lib/appdata';

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

/**
 * PM2 Manager
 *
 * PM2 daemon is a singleton - only one daemon can run system-wide at a time.
 * When pm2.connect() is called, it will:
 * - Connect to an existing daemon if one is already running
 * - Start a new daemon if none exists
 *
 * The daemon persists across CLI invocations and is shared by all Studio CLI processes.
 * The isConnected flag only tracks whether THIS process has connected to the daemon,
 * not whether the daemon itself is running (which is handled by PM2 internally).
 */

interface ProcessDescription {
	name: string;
	pid: number;
	pm_id: number;
	status: string;
	pm2_env: {
		status: string;
		restart_time: number;
		uptime: number;
		pm_uptime: number;
		created_at: number;
	};
}

interface StartOptions {
	name: string;
	script: string;
	args?: string[];
	cwd?: string;
	env?: Record< string, string >;
	instances?: number;
	exec_mode?: 'fork' | 'cluster';
	autorestart?: boolean;
	max_memory_restart?: string;
}

let isConnected = false;

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

function disconnect(): void {
	if ( isConnected ) {
		pm2.disconnect();
		isConnected = false;
	}
}

export function isDaemonRunning(): boolean {
	const homeDir = os.homedir();
	const pm2Dir = path.join( homeDir, '.pm2' );
	const rpcSocket = path.join( pm2Dir, 'rpc.sock' );
	const pidFile = path.join( pm2Dir, 'pm2.pid' );

	if ( fs.existsSync( rpcSocket ) || fs.existsSync( pidFile ) ) {
		try {
			if ( fs.existsSync( pidFile ) ) {
				const pid = parseInt( fs.readFileSync( pidFile, 'utf-8' ).trim(), 10 );
				try {
					process.kill( pid, 0 );
					return true;
				} catch {
					return false;
				}
			}
			return fs.existsSync( rpcSocket );
		} catch {
			return false;
		}
	}

	return false;
}

export async function ensureDaemonRunning(): Promise< void > {
	await connect();
}

export async function startDaemon(): Promise< void > {
	if ( isDaemonRunning() ) {
		return;
	}
	await connect();
	// Keep connection open - subsequent operations will reuse it
	// The isConnected flag prevents duplicate connections
}

export async function stopDaemon(): Promise< void > {
	await connect();
	return new Promise( ( resolve, reject ) => {
		pm2.killDaemon( ( error ) => {
			disconnect();
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

export async function startProcess( options: StartOptions ): Promise< ProcessDescription > {
	await ensureDaemonRunning();

	return new Promise( ( resolve, reject ) => {
		const processConfig: pm2.StartOptions = {
			name: options.name,
			script: options.script,
			args: options.args || [],
			cwd: options.cwd,
			env: options.env,
			instances: options.instances || 1,
			exec_mode: options.exec_mode || 'fork',
			autorestart: options.autorestart !== false,
			max_memory_restart: options.max_memory_restart,
		};

		pm2.start( processConfig, ( error, apps ) => {
			disconnect();
			if ( error ) {
				reject( error );
				return;
			}

			if ( ! apps || apps.length === 0 ) {
				reject( new Error( 'Failed to start process' ) );
				return;
			}

			resolve( apps[ 0 ] as ProcessDescription );
		} );
	} );
}

export async function stopProcess( name: string ): Promise< void > {
	await ensureDaemonRunning();

	return new Promise( ( resolve, reject ) => {
		pm2.stop( name, ( error ) => {
			disconnect();
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

export async function deleteProcess( name: string ): Promise< void > {
	await ensureDaemonRunning();

	return new Promise( ( resolve, reject ) => {
		pm2.delete( name, ( error ) => {
			disconnect();
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

export async function restartProcess( name: string ): Promise< void > {
	await ensureDaemonRunning();

	return new Promise( ( resolve, reject ) => {
		pm2.restart( name, ( error ) => {
			disconnect();
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

export async function listProcesses( autoStart = true ): Promise< ProcessDescription[] > {
	if ( autoStart ) {
		await ensureDaemonRunning();
	} else if ( ! isDaemonRunning() ) {
		return [];
	} else {
		await connect();
	}

	return new Promise( ( resolve, reject ) => {
		pm2.list( ( error, processes ) => {
			disconnect();
			if ( error ) {
				reject( error );
				return;
			}
			resolve( ( processes || [] ) as ProcessDescription[] );
		} );
	} );
}

export async function describeProcess( name: string ): Promise< ProcessDescription | null > {
	const processes = await listProcesses();
	return processes.find( ( p ) => p.name === name ) || null;
}

export function cleanup(): void {
	disconnect();
}

process.on( 'exit', cleanup );
process.on( 'SIGINT', cleanup );
process.on( 'SIGTERM', cleanup );

/**
 * Proxy Server Management Functions
 *
 * The proxy runs as a PM2-managed CLI process. When `studio proxy start` is called,
 * PM2 starts the CLI with the proxy command and keeps it running persistently.
 */

const PROXY_PROCESS_NAME = 'studio-proxy';

/**
 * Start the proxy server via PM2
 * This launches the proxy-daemon.js script which runs the proxy servers
 */
export async function startProxyProcess( scriptPath: string ): Promise< ProcessDescription > {
	await ensureDaemonRunning();

	return new Promise( ( resolve, reject ) => {
		const processConfig: pm2.StartOptions = {
			name: PROXY_PROCESS_NAME,
			script: scriptPath,
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 3000,
			kill_timeout: 5000,
			uid: 0, // Run as root to bind to ports 80 and 443
			env: {
				// Pass the real user's home directory so proxy can find appdata
				// When running as root, os.homedir() returns /var/root instead of the user's home
				STUDIO_USER_HOME: os.homedir(),
				// Pass the actual appdata file path directly from CLI
				STUDIO_APPDATA_PATH: getAppdataPath(),
			},
		};

		pm2.start( processConfig, ( error, apps ) => {
			disconnect();
			if ( error ) {
				reject( error );
				return;
			}

			if ( ! apps || apps.length === 0 ) {
				reject( new Error( 'Failed to start proxy process' ) );
				return;
			}

			resolve( apps[ 0 ] as ProcessDescription );
		} );
	} );
}

/**
 * Check if the proxy process is running
 */
export async function isProxyProcessRunning(): Promise< boolean > {
	try {
		if ( ! isDaemonRunning() ) {
			return false;
		}

		const processes = await listProcesses( false );
		return processes.some( ( p ) => p.name === PROXY_PROCESS_NAME && p.status === 'online' );
	} catch ( error ) {
		console.error( 'Error checking if proxy is running:', error );
		return false;
	}
}
