/**
 * WordPress Studio Server Child Process — Native PHP
 *
 * Runs a single WordPress site using the PHP binary's built-in web server
 * (`php -S localhost:${port} router.php`), with the site directory as the
 * working directory. Shares the IPC contract with `wordpress-server-child.ts`.
 */

import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { decodePassword } from '@studio/common/lib/passwords';
import { z } from 'zod';
import {
	managerMessageSchema,
	ChildMessageRaw,
	ServerConfig,
} from 'cli/lib/types/wordpress-server-ipc';

const ROUTER_PATH = path.resolve( import.meta.dirname, 'php', 'router.php' );
const ENSURE_WP_CONFIG_PATH = path.resolve( import.meta.dirname, 'php', 'ensure-wp-config.php' );
const SET_DEFAULT_PERMALINKS_PATH = path.resolve(
	import.meta.dirname,
	'php',
	'set-default-permalinks.php'
);
const PHP_BINARY_FILENAME = process.platform === 'win32' ? 'php.exe' : 'php';
const PHP_BINARY_PATH = path.resolve( import.meta.dirname, 'bin', PHP_BINARY_FILENAME );
// With Playground's/Studio's SQLite setup, the only required database constant is `DB_NAME`
const DEFAULT_WP_CONFIG_CONSTANTS = { DB_NAME: 'wordpress' } as const;

let phpProcess: ChildProcess | null = null;
let startupAbortController: AbortController | null = null;
let startingPromise: Promise< void > | null = null;

function logToConsole( ...args: Parameters< typeof console.log > ) {
	console.log( `[PHP Server]`, ...args );
}

function errorToConsole( ...args: Parameters< typeof console.error > ) {
	console.error( `[PHP Server]`, ...args );
}

// We allow a single `startServer` call per process. If that call throws, we expect
// `ipcMessageHandler` to kill the process.
function wrapWithStartingPromise< Args extends unknown[], Return extends void >(
	callback: ( ...args: Args ) => Promise< Return >
) {
	return async ( ...args: Args ) => {
		if ( startingPromise ) {
			return startingPromise;
		}

		startingPromise = callback( ...args );
		return startingPromise;
	};
}

async function ensureWpConfig( siteFolder: string, signal: AbortSignal ): Promise< void > {
	const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
	const wpConfigSamplePath = path.join( siteFolder, 'wp-config-sample.php' );

	if ( ! fs.existsSync( wpConfigPath ) && fs.existsSync( wpConfigSamplePath ) ) {
		await fs.promises.copyFile( wpConfigSamplePath, wpConfigPath );
	}

	await new Promise< void >( ( resolve, reject ) => {
		const phpScriptProcess = spawn(
			PHP_BINARY_PATH,
			[ ENSURE_WP_CONFIG_PATH, wpConfigPath, JSON.stringify( DEFAULT_WP_CONFIG_CONSTANTS ) ],
			{
				stdio: [ 'ignore', 'pipe', 'pipe' ],
				signal,
			}
		);

		phpScriptProcess.stdout?.pipe( process.stdout );
		phpScriptProcess.stderr?.pipe( process.stderr );

		phpScriptProcess.once( 'error', ( error: Error ) => {
			reject( error );
		} );
		phpScriptProcess.once( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve();
				return;
			}

			reject( new Error( `Failed to ensure wp-config.php constants (code: ${ code })` ) );
		} );
	} );
}

async function installWordPress( config: ServerConfig, signal: AbortSignal ): Promise< void > {
	const username = config.adminUsername ?? 'admin';
	const password = config.adminPassword ? decodePassword( config.adminPassword ) : 'password';

	const installResponse = await fetch(
		`http://localhost:${ config.port }/wp-admin/install.php?step=2`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams( {
				language: 'en',
				prefix: 'wp_',
				weblog_title: 'My WordPress Website',
				user_name: username,
				admin_password: password,
				// The installation wizard demands typing the same password twice
				admin_password2: password,
				Submit: 'Install WordPress',
				pw_weak: '1',
				admin_email: 'admin@localhost.com',
			} ),
			signal,
		}
	);

	if ( ! installResponse.ok ) {
		throw new Error(
			`Failed to install WordPress (HTTP ${ installResponse.status } ${ installResponse.statusText })`
		);
	}

	await new Promise< void >( ( resolve, reject ) => {
		const phpScriptProcess = spawn( PHP_BINARY_PATH, [ SET_DEFAULT_PERMALINKS_PATH ], {
			cwd: config.sitePath,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			signal,
		} );

		phpScriptProcess.stdout?.pipe( process.stdout );
		phpScriptProcess.stderr?.pipe( process.stderr );

		phpScriptProcess.once( 'error', ( error: Error ) => {
			reject( error );
		} );
		phpScriptProcess.once( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve();
				return;
			}

			reject( new Error( `Failed to set default permalinks (code: ${ code })` ) );
		} );
	} );
}

const startServer = wrapWithStartingPromise(
	async ( config: ServerConfig, signal: AbortSignal ): Promise< void > => {
		if ( phpProcess ) {
			logToConsole( `Server already running for site ${ config.siteId }` );
			return;
		}

		startupAbortController = new AbortController();
		const stopSignal = AbortSignal.any( [ signal, startupAbortController.signal ] );

		try {
			stopSignal.throwIfAborted();
			await ensureWpConfig( config.sitePath, stopSignal );
			stopSignal.throwIfAborted();

			const phpAddress = `localhost:${ config.port }`;
			logToConsole( `Spawning PHP built-in server on ${ phpAddress } for site ${ config.siteId }` );

			const spawnedChild = spawn( PHP_BINARY_PATH, [ '-S', phpAddress, ROUTER_PATH ], {
				cwd: config.sitePath,
				stdio: [ 'ignore', 'pipe', 'pipe' ],
			} );

			spawnedChild.stdout?.pipe( process.stdout );
			spawnedChild.stderr?.pipe( process.stderr );

			await new Promise< void >( ( resolve, reject ) => {
				spawnedChild.once( 'spawn', () => {
					resolve();
				} );
				spawnedChild.once( 'error', ( error: Error ) => {
					reject( error );
				} );
				stopSignal.addEventListener( 'abort', () => {
					reject( new DOMException( 'Aborted', 'AbortError' ) );
				} );
			} );

			stopSignal.throwIfAborted();

			// There's a brief delay between the PHP process starting and when it accepts connections
			await new Promise< void >( ( resolve ) => setTimeout( resolve, 500 ) );
			await installWordPress( config, stopSignal );

			spawnedChild.once( 'exit', ( code, signalName ) => {
				errorToConsole(
					`PHP child process exited unexpectedly (code: ${ code }, signal: ${ signalName })`
				);
				process.exit( code ?? 1 );
			} );

			phpProcess = spawnedChild;
		} catch ( error ) {
			if ( phpProcess && ! phpProcess.killed ) {
				phpProcess.kill( 'SIGKILL' );
			}

			if ( stopSignal.aborted ) {
				logToConsole( `Aborted start server operation:`, error );
			} else {
				errorToConsole( `Failed to start server:`, error );
			}

			throw error;
		} finally {
			startupAbortController = null;
		}
	}
);

const STOP_SERVER_TIMEOUT = 5000;

enum StopServerResult {
	ABORTED_STARTUP = 'ABORTED_STARTUP',
	OK = 'OK',
}

async function stopServer(): Promise< StopServerResult > {
	if ( startupAbortController ) {
		logToConsole( 'Startup operation in progress. Aborting it to stop the server…' );
		startupAbortController.abort();
		return StopServerResult.ABORTED_STARTUP;
	}

	if ( ! phpProcess ) {
		logToConsole( 'No server running, nothing to stop' );
		return StopServerResult.OK;
	}

	if ( phpProcess.exitCode !== null || phpProcess.signalCode !== null ) {
		logToConsole( 'Server already stopped' );
		return StopServerResult.OK;
	}

	const child = phpProcess;
	phpProcess = null;

	child.removeAllListeners( 'exit' );

	await new Promise< void >( ( resolve ) => {
		const forceKillTimeout = setTimeout( () => {
			errorToConsole( 'PHP child did not exit in time; sending SIGKILL' );
			if ( ! child.killed ) {
				child.kill( 'SIGKILL' );
			}
		}, STOP_SERVER_TIMEOUT );

		child.once( 'exit', () => {
			clearTimeout( forceKillTimeout );
			resolve();
		} );

		child.kill( 'SIGTERM' );
	} );

	logToConsole( 'Server stopped gracefully' );
	return StopServerResult.OK;
}

function sendErrorMessage( messageId: string, error: unknown ): Promise< void > {
	return new Promise( ( resolve ) => {
		const errorResponse: ChildMessageRaw = {
			originalMessageId: messageId,
			topic: 'error',
			errorMessage: error instanceof Error ? error.message : String( error ),
			errorStack: error instanceof Error ? error.stack : undefined,
		};
		process.send!( errorResponse, () => {
			resolve();
		} );
	} );
}

const abortControllers: Record< string, AbortController > = {};

async function ipcMessageHandler( packet: unknown ) {
	const messageResult = managerMessageSchema.safeParse( packet );

	if ( ! messageResult.success ) {
		errorToConsole( 'Invalid message received:', messageResult.error );

		const minimalMessageSchema = z.object( { id: z.string() } );
		const minimalMessage = minimalMessageSchema.safeParse( packet );
		if ( minimalMessage.success ) {
			await sendErrorMessage( minimalMessage.data.id, messageResult.error );
		}
		return;
	}

	const validMessage = messageResult.data;
	if ( validMessage.topic !== 'abort' ) {
		abortControllers[ validMessage.messageId ] = new AbortController();
	}
	const abortController = abortControllers[ validMessage.messageId ];

	logToConsole( `Received ${ validMessage.topic } message` );

	try {
		let result: unknown;

		switch ( validMessage.topic ) {
			case 'abort':
				abortController?.abort();
				return;
			case 'start-server':
				result = await startServer( validMessage.data.config, abortController.signal );
				break;
			case 'stop-server':
				result = await stopServer();
				break;
			case 'run-blueprint':
			case 'wp-cli-command':
				throw new Error(
					`Message "${ validMessage.topic }" is not supported by the native PHP runtime`
				);
			default:
				throw new Error( `Unknown message.` );
		}

		const response: ChildMessageRaw = {
			originalMessageId: validMessage.messageId,
			topic: 'result',
			result,
		};
		process.send!( response );

		if ( validMessage.topic === 'stop-server' && result === StopServerResult.OK ) {
			process.disconnect();
		}
	} catch ( error ) {
		errorToConsole( `Error handling message ${ validMessage.topic }:`, error );
		await sendErrorMessage( validMessage.messageId, error );
		errorToConsole( 'Killing process because of', error );
		process.exit( 1 );
	} finally {
		delete abortControllers[ validMessage.messageId ];
	}
}

function killPhpProcess(): void {
	if ( phpProcess && ! phpProcess.killed ) {
		try {
			phpProcess.kill( 'SIGKILL' );
		} catch {
			// Best effort — nothing useful to do if this fails.
		}
	}
}

// If this node process is going down (normal exit or IPC disconnect), make sure PHP goes with it.
process.on( 'exit', killPhpProcess );
process.on( 'disconnect', () => {
	killPhpProcess();
} );

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
