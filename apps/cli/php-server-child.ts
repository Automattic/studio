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
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { writeStudioMuPluginsForNativePhpRuntime } from '@studio/common/lib/mu-plugins';
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
import {
	getBlueprintsPharPath,
	getPhpBinaryPath,
	getWpCliPharPath,
} from './lib/dependency-management/paths';

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
const DEFAULT_WP_CONFIG_CONSTANTS = { DB_NAME: 'wordpress' } as const;

let phpProcess: ChildProcess | null = null;
let startupAbortController: AbortController | null = null;
let startingPromise: Promise< void > | null = null;
let blueprintQueue: Promise< unknown > = Promise.resolve();

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
	enableXdebug?: boolean;
};

// Extensions to enable on Windows via `-d extension=<name>`. Mirrors the
// windows-x86_64 matrix.extensions entry in
// .github/workflows/build-php-cli-binaries.yml, with three classes filtered out:
//   - mbregex: not a runtime extension, it's an mbstring feature flag
//   - mysqlnd: linked into php.exe as a core dependency of mysqli/pdo_mysql
//   - zlib:    linked into php.exe
//   - opcache: a Zend extension, loaded separately via zend_extension below
// On macOS every extension is baked into the `php` binary by static-php-cli,
// so this list is irrelevant there.
const WINDOWS_PHP_EXTENSIONS = [
	'apcu',
	'bcmath',
	'calendar',
	'ctype',
	'curl',
	'dba',
	'dom',
	'exif',
	'fileinfo',
	'filter',
	'ftp',
	'gd',
	'iconv',
	'igbinary',
	'intl',
	'mbstring',
	'mysqli',
	'openssl',
	'pdo',
	'pdo_mysql',
	'pdo_sqlite',
	'phar',
	'redis',
	'session',
	'shmop',
	'simplexml',
	'sockets',
	'sodium',
	'sqlite3',
	'ssh2',
	'tokenizer',
	'xml',
	'xmlreader',
	'xmlwriter',
	'yaml',
	'zip',
] as const;

// Process-scoped opcache dir, created lazily and removed when the process exits
let opcacheRootDir: string | null = null;

function getOpcacheRootDir(): string {
	if ( opcacheRootDir ) {
		return opcacheRootDir;
	}

	// Resolve to the long-form path on Windows. `os.tmpdir()` can return an 8.3
	// short name (e.g. C:\Users\BUILDK~1\AppData\…) when the user has a long
	// username, and PHP's INI scanner treats `~` as a special token, breaking
	// `-d opcache.file_cache=<path>` parsing.
	const tmpRoot =
		process.platform === 'win32' ? fs.realpathSync.native( os.tmpdir() ) : os.tmpdir();
	opcacheRootDir = fs.mkdtempSync( path.join( tmpRoot, 'studio-opcache-' ) );
	const dirToClean = opcacheRootDir;
	process.once( 'exit', () => {
		try {
			fs.rmSync( dirToClean, { recursive: true, force: true } );
		} catch {
			// Best effort. The OS will reap tmp eventually.
		}
	} );
	return opcacheRootDir;
}

function getExtensionDir( phpVersion: NativePhpSupportedVersion ): string {
	return path.join( path.dirname( getPhpBinaryPath( phpVersion ) ), 'ext' );
}

function getXdebugFilename(): string {
	return process.platform === 'win32' ? 'php_xdebug.dll' : 'xdebug.so';
}

function getDefaultPhpArgs(
	phpVersion: NativePhpSupportedVersion,
	enableXdebug: boolean
): string[] {
	const args: string[] = [];
	const extensionDir = getExtensionDir( phpVersion );

	if ( process.platform === 'win32' ) {
		// Partition the file_cache by PHP version: opcache's on-disk script blob
		// format isn't stable across minor versions, and reusing a cache populated
		// by a different PHP can crash the server at startup on Windows.
		const cacheId = `php${ phpVersion }`;
		const cacheDirectory = path.join( getOpcacheRootDir(), cacheId );
		fs.mkdirSync( cacheDirectory, { recursive: true } );

		args.push(
			'-d',
			`opcache.file_cache="${ cacheDirectory }"`,
			'-d',
			'opcache.file_cache_fallback=1',
			'-d',
			`opcache.cache_id="studio-${ cacheId }"`
		);

		// Load every bundled DLL from the artifact's ext/ directory.
		// windows.php.net's prebuilt php.exe doesn't auto-load extensions;
		// each one needs an explicit `extension=` (or `zend_extension=` for
		// opcache) directive.
		args.push( '-d', `extension_dir="${ extensionDir }"` );
		args.push( '-d', `zend_extension=opcache` );
		for ( const extension of WINDOWS_PHP_EXTENSIONS ) {
			args.push( '-d', `extension=${ extension }` );
		}
	}

	if ( enableXdebug ) {
		// On macOS the `php` binary has every other extension baked in and ext/
		// contains only xdebug.so; on Windows extension_dir is already set
		// above. Either way the Zend extension path is ext/<filename>.
		if ( process.platform !== 'win32' ) {
			args.push( '-d', `extension_dir="${ extensionDir }"` );
		}
		args.push(
			'-d',
			`zend_extension="${ path.join( extensionDir, getXdebugFilename() ) }"`,
			'-d',
			'xdebug.mode=debug'
		);
	}

	return args;
}

function spawnPhpProcess(
	args: string[],
	{ phpVersion, cwd, signal, mode = 'pipe', enableXdebug = false }: SpawnPhpProcessOptions
): ChildProcess {
	const defaultArgs = getDefaultPhpArgs( phpVersion, enableXdebug );
	const phpArgs = [ ...defaultArgs, ...args ];
	const phpScriptProcess = spawn( getPhpBinaryPath( phpVersion ), phpArgs, {
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
		const reportActivity = () => process.send?.( { topic: 'activity' } );
		phpScriptProcess.stdout?.on( 'data', ( chunk ) => {
			reportActivity();
			if ( mode === 'capture-stdout' ) {
				stdout += chunk.toString();
			}
		} );
		phpScriptProcess.stderr?.on( 'data', reportActivity );

		phpScriptProcess.once( 'error', ( error: Error ) => {
			reject( error );
		} );
		phpScriptProcess.once( 'close', ( code ) => {
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
	signal: AbortSignal,
	config?: Pick< ServerConfig, 'enableDebugLog' | 'enableDebugDisplay' >
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

	const enableDebugLog = config?.enableDebugLog ?? false;
	const enableDebugDisplay = config?.enableDebugDisplay ?? false;
	const constants = {
		...DEFAULT_WP_CONFIG_CONSTANTS,
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
	};

	try {
		await runPhpCommand(
			[
				'-r',
				ensureWpConfigScript,
				WP_CONFIG_TRANSFORMER_PATH,
				wpConfigPath,
				JSON.stringify( constants ),
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

	const siteTitle = config.siteTitle ?? 'My WordPress Website';
	const username = config.adminUsername ?? 'admin';
	const password = config.adminPassword ? decodePassword( config.adminPassword ) : 'password';
	const email = config.adminEmail ?? 'admin@localhost.com';
	const siteUrl = config.absoluteUrl ?? `http://localhost:${ config.port }`;
	// Only pass --locale for non-default locales; WP-CLI defaults to en_US for English.
	// DEFAULT_LOCALE is 'en' which is not a valid WP locale code.
	const locale =
		config.siteLanguage && config.siteLanguage !== DEFAULT_LOCALE ? config.siteLanguage : undefined;

	await runPhpCommand(
		[
			getWpCliPharPath(),
			'core',
			'install',
			`--path=${ config.sitePath }`,
			`--url=${ siteUrl }`,
			`--title=${ siteTitle }`,
			`--admin_user=${ username }`,
			`--admin_password=${ password }`,
			`--admin_email=${ email }`,
			...( locale ? [ `--locale=${ locale }` ] : [] ),
			'--skip-email',
		],
		{ phpVersion, signal }
	);

	// Store the admin username in WP options so the auto-login MU plugin can find it.
	await runPhpCommand(
		[
			getWpCliPharPath(),
			'option',
			'update',
			'studio_admin_username',
			username,
			`--path=${ config.sitePath }`,
		],
		{ phpVersion, signal }
	);

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
		await ensureWpConfig( config.sitePath, phpVersion, stopSignal, config );
		stopSignal.throwIfAborted();
		await writeStudioMuPluginsForNativePhpRuntime( config.sitePath, config.isWpAutoUpdating );
		stopSignal.throwIfAborted();
		await installWordPress( config, phpVersion, stopSignal );
		stopSignal.throwIfAborted();

		if ( config.blueprint ) {
			await runBlueprint( config, config.blueprint, phpVersion, stopSignal );
			stopSignal.throwIfAborted();
		}

		const phpAddress = `localhost:${ config.port }`;
		logToConsole( `Spawning PHP built-in server on ${ phpAddress } for site ${ config.siteId }` );

		const serverChild = spawnPhpProcess( [ '-S', phpAddress, ROUTER_PATH ], {
			phpVersion,
			cwd: config.sitePath,
			enableXdebug: config.enableXdebug,
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

		serverChild.once( 'exit', ( code, signalName ) => {
			errorToConsole(
				`PHP child process exited unexpectedly (code: ${ code }, signal: ${ signalName })`
			);
			process.exit( code ?? 1 );
		} );

		stopSignal.throwIfAborted();
		await waitForServerReady( `http://localhost:${ config.port }/`, stopSignal );

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

async function runBlueprint(
	config: ServerConfig,
	blueprint: NonNullable< ServerConfig[ 'blueprint' ] >,
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal
): Promise< void > {
	// blueprints.phar's CLI accepts only local paths. Remote URIs are supported by
	// the Playground runtime (via FetchFilesystem) but not here.
	if ( blueprint.uri.startsWith( 'http://' ) || blueprint.uri.startsWith( 'https://' ) ) {
		throw new Error(
			`Remote blueprint URIs are not supported by the native PHP runtime: ${ blueprint.uri }`
		);
	}

	// Mirror the Playground runtime: merge Studio's defaults into blueprint.contents
	// with the same precedence so both runtimes apply blueprints consistently.
	const enableDebugLog = config.enableDebugLog ?? false;
	const enableDebugDisplay = config.enableDebugDisplay ?? false;
	const defaultConstants: Record< string, boolean | string > = {
		// Fallback for sites where DB_NAME was stripped from wp-config.php — the SQLite
		// driver (v3+) requires a non-empty DB_NAME at runtime.
		DB_NAME: 'wordpress',
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
	};

	const preferredVersions = {
		php: config.phpVersion || blueprint.contents?.preferredVersions?.php || DEFAULT_PHP_VERSION,
		wp: config.wpVersion || blueprint.contents?.preferredVersions?.wp || 'latest',
	};
	blueprint.contents.constants = {
		...blueprint.contents.constants,
		...defaultConstants,
	};
	blueprint.contents.preferredVersions = preferredVersions;

	// Write the merged blueprint next to the original so blueprints.phar resolves any
	// relative file references against the original blueprint's directory — its runner
	// uses dirname(blueprintPath) as the execution context.
	const blueprintDir = path.dirname( blueprint.uri );
	const tmpPath = path.join( blueprintDir, `studio-blueprint-${ config.siteId }.json` );
	await fs.promises.writeFile( tmpPath, JSON.stringify( blueprint.contents ) );

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
	// Use 'junction' type so this works on Windows without elevated permissions.
	// On macOS/Linux the type argument is ignored for directories.
	const needsSymlink = fs.existsSync( muPluginsSqlite ) && ! fs.existsSync( pluginsSqlite );
	let symlinkIno: number | undefined;
	if ( needsSymlink ) {
		fs.symlinkSync( muPluginsSqlite, pluginsSqlite, 'junction' );
		// Record the inode so cleanup only removes the entry we created. statSync follows
		// the link, so the inode resolves to the mu-plugins target and changes if the
		// entry has been replaced with unrelated content.
		symlinkIno = fs.statSync( pluginsSqlite ).ino;
	}

	try {
		await runPhpCommand(
			[
				getBlueprintsPharPath(),
				'exec',
				tmpPath,
				'--mode=apply-to-existing-site',
				`--site-path=${ config.sitePath }`,
				`--site-url=${ config.absoluteUrl ?? `http://localhost:${ config.port }` }`,
				'--db-engine=sqlite',
			],
			{ phpVersion, signal }
		);
	} finally {
		await fs.promises.unlink( tmpPath ).catch( () => {} );
		if ( needsSymlink ) {
			try {
				if ( fs.statSync( pluginsSqlite ).ino === symlinkIno ) {
					// Use rm with recursive to handle Windows junctions, which fs.unlink
					// rejects with EPERM. The inode check above guards against accidentally
					// recursing into an unrelated directory.
					await fs.promises.rm( pluginsSqlite, { recursive: true, force: true } );
				}
			} catch {
				// Best effort — leaving the symlink behind is non-fatal.
			}
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
				// Track in-flight startup operations so concurrent messages cannot spawn two PHP servers.
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
			case 'run-blueprint': {
				const blueprintConfig = validMessage.data.config;
				const blueprintPhpVersion = validateNativePhpVersion( blueprintConfig.phpVersion ?? '' );
				await ensureWpConfig(
					blueprintConfig.sitePath,
					blueprintPhpVersion,
					abortController.signal,
					blueprintConfig
				);
				await writeStudioMuPluginsForNativePhpRuntime(
					blueprintConfig.sitePath,
					blueprintConfig.isWpAutoUpdating
				);
				await installWordPress( blueprintConfig, blueprintPhpVersion, abortController.signal );
				if ( ! blueprintConfig.blueprint ) {
					throw new Error( 'Blueprint is required' );
				}
				const blueprint = blueprintConfig.blueprint;
				// Sequential queue: each message waits for the previous to settle before
				// running its own blueprint. Distinct configs are not coalesced.
				const next = blueprintQueue
					.catch( () => {} )
					.then( () =>
						runBlueprint( blueprintConfig, blueprint, blueprintPhpVersion, abortController.signal )
					);
				blueprintQueue = next;
				result = await next;
				break;
			}
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

		// If the `stopServer` function ran successfully, the last open handle should be the IPC channel.
		// Disconnect so that the process can exit cleanly.
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
			// Detach the unexpected-exit listener so the imminent SIGKILL is not logged as a crash.
			phpProcess.removeAllListeners( 'exit' );
			phpProcess.kill( 'SIGKILL' );
		} catch {
			// Best effort — nothing useful to do if this fails.
		}
	}
}

function shutdownOnSignal( signal: NodeJS.Signals ): void {
	logToConsole( `Received ${ signal }, shutting down` );
	killPhpProcess();
	// Follow the Unix convention of `128 + signum` so the exit code reflects the signal.
	const signum = os.constants.signals[ signal ] ?? 0;
	process.exit( 128 + signum );
}

// If this node process is going down (normal exit or IPC disconnect), make sure PHP goes with it.
process.on( 'exit', killPhpProcess );
process.on( 'disconnect', () => {
	logToConsole( 'IPC channel disconnected, shutting down' );
	killPhpProcess();
	// Without an explicit exit, the wrapper would linger until the event loop drains,
	// which delays the daemon's stop sequence and risks the force-kill timer firing.
	process.exit( 0 );
} );

// Without explicit signal handlers, the process is terminated abruptly and the 'exit' event
// does not fire — leaving the PHP child orphaned. These handlers ensure cleanup runs.
process.on( 'SIGTERM', shutdownOnSignal );
process.on( 'SIGINT', shutdownOnSignal );

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
