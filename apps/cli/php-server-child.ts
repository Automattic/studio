/**
 * WordPress Studio Server Child Process — Native PHP
 *
 * Runs a single WordPress site using the PHP binary's built-in web server
 * (`php -S localhost:${port} router.php`), with the site directory as the
 * working directory. Shares the IPC contract with `wordpress-server-child.ts`.
 */

import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePassword } from '@studio/common/lib/passwords';
import {
	NativePhpSupportedVersion,
	validateNativePhpVersion,
} from '@studio/common/lib/php-binary-metadata';
import { z } from 'zod';
import {
	managerMessageSchema,
	ChildMessageRaw,
	ServerConfig,
} from 'cli/lib/types/wordpress-server-ipc';
import { getBlueprintsPharPath, getPhpBinaryPath } from './lib/dependency-management/paths';

const ROUTER_PATH = path.resolve( import.meta.dirname, 'php', 'router.php' );
const SET_DEFAULT_PERMALINKS_PATH = path.resolve(
	import.meta.dirname,
	'php',
	'set-default-permalinks.php'
);
const WP_CONFIG_TRANSFORMER_PATH = path.resolve(
	import.meta.dirname,
	'php',
	'wp-config-transformer.php'
);
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

type SpawnPhpProcessOptions = {
	phpVersion: NativePhpSupportedVersion;
	cwd?: string;
	signal?: AbortSignal;
	mode?: 'pipe' | 'capture-stdout';
};

function spawnPhpProcess(
	args: string[],
	{ phpVersion, cwd, signal, mode = 'pipe' }: SpawnPhpProcessOptions
): ChildProcess {
	const phpScriptProcess = spawn( getPhpBinaryPath( phpVersion ), args, {
		cwd,
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		signal,
	} );

	if ( mode === 'pipe' ) {
		phpScriptProcess.stdout?.pipe( process.stdout );
	}

	// Keep stderr visible in all modes for easier debugging.
	if ( mode === 'pipe' || mode === 'capture-stdout' ) {
		phpScriptProcess.stderr?.pipe( process.stderr );
	}

	return phpScriptProcess;
}

type RunPhpCommandOptions = SpawnPhpProcessOptions;

async function runPhpCommand(
	args: string[],
	{ phpVersion, cwd, signal, mode = 'pipe' }: RunPhpCommandOptions
): Promise< { stdout: string } > {
	return await new Promise< { stdout: string } >( ( resolve, reject ) => {
		const phpScriptProcess = spawnPhpProcess( args, {
			phpVersion,
			cwd,
			signal,
			mode,
		} );

		let stdout = '';
		if ( mode === 'capture-stdout' ) {
			phpScriptProcess.stdout?.on( 'data', ( chunk ) => {
				stdout += chunk.toString();
			} );
		}

		phpScriptProcess.once( 'error', ( error: Error ) => {
			reject( error );
		} );
		phpScriptProcess.once( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve( { stdout } );
				return;
			}

			reject( new Error( `PHP command failed (code: ${ code })` ) );
		} );
	} );
}

async function ensureWpConfig(
	siteFolder: string,
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal
): Promise< void > {
	const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
	const wpConfigSamplePath = path.join( siteFolder, 'wp-config-sample.php' );
	const ensureWpConfigScript = `
$transformer_path = $argv[1] ?? '';
$wp_config_path = $argv[2] ?? '';
$constants = json_decode( $argv[3] ?? '', true );

require_once $transformer_path;

$transformer = WP_Config_Transformer::from_file( $wp_config_path );
$transformer->define_constants( $constants );
$transformer->to_file( $wp_config_path );
`;

	if ( ! fs.existsSync( wpConfigPath ) && fs.existsSync( wpConfigSamplePath ) ) {
		await fs.promises.copyFile( wpConfigSamplePath, wpConfigPath );
	}

	try {
		await runPhpCommand(
			[
				'-r',
				ensureWpConfigScript,
				WP_CONFIG_TRANSFORMER_PATH,
				wpConfigPath,
				JSON.stringify( DEFAULT_WP_CONFIG_CONSTANTS ),
			],
			{ phpVersion, signal }
		);
	} catch ( error ) {
		throw new Error(
			`Failed to ensure wp-config.php constants: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
}

async function isWordPressInstalled(
	siteFolder: string,
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal
): Promise< boolean > {
	const installationCheckScript = `
error_reporting( E_ERROR );
ini_set( 'display_errors', '0' );

$wp_load = getcwd() . '/wp-load.php';
if ( ! file_exists( $wp_load ) ) {
	echo '0';
	exit( 0 );
}
require_once $wp_load;
echo is_blog_installed() ? '1' : '0';
`;

	let stdout = '';
	try {
		const result = await runPhpCommand( [ '-r', installationCheckScript ], {
			phpVersion,
			cwd: siteFolder,
			signal,
			mode: 'capture-stdout',
		} );
		stdout = result.stdout;
	} catch ( error ) {
		throw new Error(
			`Failed to check WordPress installation status: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}

	const status = stdout.trim();
	return status === '1';
}

async function waitForServerReady( url: string, signal: AbortSignal ): Promise< void > {
	const pollIntervalMs = 50;
	const timeoutMs = 30_000;
	const deadline = Date.now() + timeoutMs;

	while ( true ) {
		signal.throwIfAborted();
		try {
			await fetch( url, { signal } );
			return;
		} catch {
			signal.throwIfAborted();
			if ( Date.now() > deadline ) {
				throw new Error( `PHP server did not start within ${ timeoutMs }ms` );
			}
			await new Promise< void >( ( resolve ) => setTimeout( resolve, pollIntervalMs ) );
		}
	}
}

async function installWordPress(
	config: ServerConfig,
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal
): Promise< void > {
	const alreadyInstalled = await isWordPressInstalled( config.sitePath, phpVersion, signal );
	if ( alreadyInstalled ) {
		logToConsole( `WordPress already installed for site ${ config.siteId }; skipping installer` );
		return;
	}

	const siteLanguage = config.siteLanguage ?? 'en';
	const siteTitle = config.siteTitle ?? 'My WordPress Website';
	const username = config.adminUsername ?? 'admin';
	const password = config.adminPassword ? decodePassword( config.adminPassword ) : 'password';
	const email = config.adminEmail ?? 'admin@localhost.com';

	const installResponse = await fetch(
		`http://localhost:${ config.port }/wp-admin/install.php?step=2`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams( {
				language: siteLanguage,
				prefix: 'wp_',
				weblog_title: siteTitle,
				user_name: username,
				admin_password: password,
				// The installation wizard demands typing the same password twice
				admin_password2: password,
				Submit: 'Install WordPress',
				pw_weak: '1',
				admin_email: email,
			} ),
			signal,
		}
	);

	if ( ! installResponse.ok ) {
		throw new Error(
			`Failed to install WordPress (HTTP ${ installResponse.status } ${ installResponse.statusText })`
		);
	}

	try {
		await runPhpCommand( [ SET_DEFAULT_PERMALINKS_PATH ], {
			phpVersion,
			cwd: config.sitePath,
			signal,
		} );
	} catch ( error ) {
		throw new Error(
			`Failed to set default permalinks: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
}

async function startServer( config: ServerConfig, signal: AbortSignal ): Promise< void > {
	if ( phpProcess ) {
		logToConsole( `Server already running for site ${ config.siteId }` );
		return;
	}

	const phpVersion = validateNativePhpVersion( config.phpVersion ?? '' );
	startupAbortController = new AbortController();
	const stopSignal = AbortSignal.any( [ signal, startupAbortController.signal ] );
	let spawnedChild: ChildProcess | null = null;

	try {
		stopSignal.throwIfAborted();
		await ensureWpConfig( config.sitePath, phpVersion, stopSignal );
		stopSignal.throwIfAborted();

		const phpAddress = `localhost:${ config.port }`;
		logToConsole( `Spawning PHP built-in server on ${ phpAddress } for site ${ config.siteId }` );

		const serverChild = spawnPhpProcess( [ '-S', phpAddress, ROUTER_PATH ], {
			phpVersion,
			cwd: config.sitePath,
		} );
		spawnedChild = serverChild;

		await new Promise< void >( ( resolve, reject ) => {
			serverChild.once( 'spawn', () => {
				resolve();
			} );
			serverChild.once( 'error', ( error: Error ) => {
				reject( error );
			} );
			stopSignal.addEventListener( 'abort', () => {
				reject( new DOMException( 'Aborted', 'AbortError' ) );
			} );
		} );

		stopSignal.throwIfAborted();

		await waitForServerReady( `http://localhost:${ config.port }/`, stopSignal );
		await installWordPress( config, phpVersion, stopSignal );

		if ( config.blueprint ) {
			await runBlueprint( config, stopSignal );
		}

		serverChild.once( 'exit', ( code, signalName ) => {
			errorToConsole(
				`PHP child process exited unexpectedly (code: ${ code }, signal: ${ signalName })`
			);
			process.exit( code ?? 1 );
		} );

		phpProcess = serverChild;
	} catch ( error ) {
		if ( spawnedChild && ! spawnedChild.killed ) {
			spawnedChild.kill( 'SIGKILL' );
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

function runProcessToCompletion(
	command: string,
	args: string[],
	options: { cwd?: string; signal?: AbortSignal } = {}
): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( command, args, {
			cwd: options.cwd,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			signal: options.signal,
		} );

		const onChunk = () => process.send?.( { topic: 'activity' } );
		child.stdout?.on( 'data', ( chunk: Buffer ) => {
			process.stdout.write( chunk );
			onChunk();
		} );
		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			process.stderr.write( chunk );
			onChunk();
		} );

		child.on( 'error', reject );
		child.on( 'close', ( code ) => {
			if ( code === 0 ) resolve();
			else reject( new Error( `Process exited with code ${ code }` ) );
		} );
	} );
}

async function runBlueprint( config: ServerConfig, signal: AbortSignal ): Promise< void > {
	const blueprintJson = JSON.stringify( config.blueprint!.contents );
	const tmpPath = path.join( os.tmpdir(), `studio-blueprint-${ config.siteId }.json` );
	await fs.promises.writeFile( tmpPath, blueprintJson );

	// blueprints.phar checks wp-content/plugins/sqlite-database-integration/load.php to detect
	// SQLite, but Studio puts it in mu-plugins. Create a temporary symlink so the PHAR can find it.
	const muPluginsSqlite = path.join(
		config.sitePath,
		'wp-content',
		'mu-plugins',
		'sqlite-database-integration'
	);
	const pluginsSqlite = path.join(
		config.sitePath,
		'wp-content',
		'plugins',
		'sqlite-database-integration'
	);
	const needsSymlink = fs.existsSync( muPluginsSqlite ) && ! fs.existsSync( pluginsSqlite );
	if ( needsSymlink ) {
		fs.symlinkSync( muPluginsSqlite, pluginsSqlite );
	}

	try {
		await runProcessToCompletion(
			getPhpBinaryPath(),
			[
				getBlueprintsPharPath(),
				'exec',
				tmpPath,
				'--mode=apply-to-existing-site',
				`--site-path=${ config.sitePath }`,
				`--site-url=${ config.absoluteUrl ?? `http://localhost:${ config.port }` }`,
				'--db-engine=sqlite',
			],
			{ signal }
		);
	} finally {
		await fs.promises.unlink( tmpPath ).catch( () => {} );
		if ( needsSymlink ) {
			await fs.promises.unlink( pluginsSqlite ).catch( () => {} );
		}
	}
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
				// Share an in-flight startup so concurrent start messages cannot spawn two PHP servers.
				if ( ! startingPromise ) {
					startingPromise = startServer( validMessage.data.config, abortController.signal ).finally(
						() => {
							startingPromise = null;
						}
					);
				}
				result = await startingPromise;
				break;
			case 'stop-server':
				result = await stopServer();
				break;
			case 'run-blueprint':
				await runBlueprint( validMessage.data.config, abortController.signal );
				result = undefined;
				break;
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
