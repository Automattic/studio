/**
 * Native PHP site server — our "Poor Man's php-fpm".
 *
 * Runs a WordPress site as a fixed pool of `php -S … router.php` workers with a
 * Node.js HTTP proxy in front that load-balances requests across them: a cheap
 * stand-in for fpm-style process concurrency, not a real FastCGI process manager.
 *
 * Shares the IPC contract with the Playground-based `wordpress-server-child.ts`.
 */

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { writeStudioMuPluginsForNativePhpRuntime } from '@studio/common/lib/mu-plugins';
import { resolveNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import {
	getSiteFileAccess,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
} from '@studio/common/lib/site-file-access';
import { z } from 'zod';
import {
	managerMessageSchema,
	ChildMessageRaw,
	ServerConfig,
} from 'cli/lib/types/wordpress-server-ipc';
import { requestSetAdminCredentials, toUrlSearchParams } from './lib/admin-credentials';
import { getPhpMyAdminPath } from './lib/dependency-management/paths';
import { runBlueprint } from './lib/native-php/blueprints';
import { containsPath, foldContainedPaths } from './lib/native-php/open-basedir';
import {
	killAllLivePhpProcesses,
	spawnPhpProcess,
	stopPhpChild,
	waitForChildSpawn,
} from './lib/native-php/php-process';
import {
	getNativePhpMyAdminWpEnvPath,
	getPhpMyAdminSessionPath,
	writeNativePhpMyAdminWpEnv,
} from './lib/native-php/phpmyadmin';
import {
	ensureWpConfig,
	installWordPress,
	writeSiteUrlPrependFile,
} from './lib/native-php/site-setup';
import { SymlinkWatcher, collectSymlinkAllowlistEntries } from './lib/symlinks';
import type { ChildProcess } from 'node:child_process';

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

// Tracks how many proxied requests each PHP worker is currently handling.
// Each `php -S` worker processes one request at a time, so a non-zero count
// means the worker is busy and any additional requests are queued at the TCP
// layer. The picker uses these counts to prefer idle workers, then to balance
// the queue depth when all are busy.
class PhpWorkerRequestTracker {
	private readonly counts: number[];

	constructor( size: number ) {
		this.counts = new Array( size ).fill( 0 );
	}

	get( index: number ): number {
		return this.counts[ index ] ?? 0;
	}

	set( index: number, value: number ): void {
		if ( index < 0 || index >= this.counts.length ) {
			return;
		}
		this.counts[ index ] = Math.max( 0, value );
	}

	getFirstFreeWorker(): number {
		let bestIndex = 0;
		for ( let i = 1; i < this.counts.length; i++ ) {
			if ( this.counts[ i ] < this.counts[ bestIndex ] ) {
				bestIndex = i;
			}
		}
		return bestIndex;
	}
}

let phpProcess: ChildProcess | null = null;
let phpWorkerProcesses: ChildProcess[] = [];
let phpProxyServer: http.Server | null = null;
let phpWorkerPorts: number[] = [];
let phpWorkerRequestTracker = new PhpWorkerRequestTracker( 0 );
let startupAbortController: AbortController | null = null;
let startingPromise: Promise< void > | null = null;
let blueprintQueue: Promise< unknown > = Promise.resolve();

// Symlink-aware open_basedir state. PHP's open_basedir cannot be extended at
// runtime, so when a new symlink appears under the site directory we have to
// restart the PHP server with an updated allowlist.
//
// Held as two sets so a rescan can replace the scanned half wholesale: static
// entries are fixed for the life of the server, while symlink targets come and go
// as plugins and themes are linked and unlinked.
const staticOpenBasedirAllowlist: Set< string > = new Set();
let symlinkOpenBasedirAllowlist: Set< string > = new Set();
// The list the running workers were started with. A rescan diffs against it:
// added entries need a restart, removed ones can wait.
let appliedOpenBasedirAllowlist: string[] = [];
let symlinkWatcher: SymlinkWatcher | null = null;
let symlinkRestartTimer: NodeJS.Timeout | null = null;
let runningConfig: ServerConfig | null = null;

const SYMLINK_RESTART_DEBOUNCE_MS = 750;
const STOP_SERVER_TIMEOUT = 5000;
const NATIVE_PHP_WORKER_POOL_SIZE = 4;

// "Site directory" file access applies the open_basedir jail and
// disable_functions list; "all files" runs PHP unrestricted.
function isFileAccessRestricted( config: ServerConfig ): boolean {
	return getSiteFileAccess( config ) === SITE_FILE_ACCESS_SITE_DIRECTORY;
}

function getEffectiveOpenBasedirAllowlist(): string[] {
	return foldContainedPaths( [ ...staticOpenBasedirAllowlist, ...symlinkOpenBasedirAllowlist ] );
}

function isCoveredByOpenBasedirAllowlist( target: string ): boolean {
	return getEffectiveOpenBasedirAllowlist().some( ( entry ) => containsPath( entry, target ) );
}

function clearOpenBasedirAllowlist(): void {
	staticOpenBasedirAllowlist.clear();
	symlinkOpenBasedirAllowlist = new Set();
	appliedOpenBasedirAllowlist = [];
}

function logToConsole( ...args: Parameters< typeof console.log > ) {
	console.log( `[PHP Server]`, ...args );
}

function errorToConsole( ...args: Parameters< typeof console.error > ) {
	console.error( `[PHP Server]`, ...args );
}

function shouldUsePrimaryWorker( req: http.IncomingMessage ): boolean {
	const method = req.method?.toUpperCase() ?? 'GET';
	if ( ! [ 'GET', 'HEAD', 'OPTIONS' ].includes( method ) ) {
		return true;
	}

	const requestUrl = req.url ?? '/';
	if ( requestUrl.startsWith( '/phpmyadmin' ) ) {
		return true;
	}

	return false;
}

function pickPhpWorker( req: http.IncomingMessage ): { index: number; port: number } {
	if ( phpWorkerPorts.length === 0 ) {
		throw new Error( 'No PHP worker ports are available' );
	}

	if ( shouldUsePrimaryWorker( req ) ) {
		return { index: 0, port: phpWorkerPorts[ 0 ] };
	}

	const bestIndex = phpWorkerRequestTracker.getFirstFreeWorker();
	return { index: bestIndex, port: phpWorkerPorts[ bestIndex ] };
}

async function getAvailablePort(): Promise< number > {
	return await new Promise< number >( ( resolve, reject ) => {
		const server = net.createServer();
		server.unref();
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			const address = server.address();
			if ( ! address || typeof address === 'string' ) {
				server.close( () => reject( new Error( 'Could not allocate a PHP worker port' ) ) );
				return;
			}
			const port = address.port;
			server.close( () => resolve( port ) );
		} );
	} );
}

async function waitForServerReady( url: string, signal?: AbortSignal ): Promise< void > {
	const pollIntervalMs = 50;
	const timeoutMs = 30_000;
	const deadline = Date.now() + timeoutMs;

	while ( true ) {
		signal?.throwIfAborted();
		try {
			await fetch( url, { redirect: 'manual', signal } );
			return;
		} catch {
			signal?.throwIfAborted();
			if ( Date.now() > deadline ) {
				throw new Error( `PHP server did not start within ${ timeoutMs }ms` );
			}
			await new Promise< void >( ( resolve ) => setTimeout( resolve, pollIntervalMs ) );
		}
	}
}

async function setAdminCredentials( config: ServerConfig, signal: AbortSignal ): Promise< void > {
	try {
		await requestSetAdminCredentials( config, async ( request ) => {
			const response = await fetch( `http://localhost:${ config.port }${ request.url }`, {
				method: request.method,
				body: toUrlSearchParams( request.body ),
				signal,
			} );
			if ( ! response.ok ) {
				throw new Error( await getAdminCredentialsErrorMessage( response ) );
			}
		} );
	} catch ( error ) {
		throw new Error(
			`Failed to set admin credentials: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
}

async function getAdminCredentialsErrorMessage( response: Response ): Promise< string > {
	const text = await response.text();
	try {
		const result = JSON.parse( text ) as { error?: string };
		return result.error ?? text;
	} catch {
		return text || response.statusText;
	}
}

// The symlink watcher is used to detect new symlinks in wp-content and its subdirectories. When a
// new symlink is detected, it is added to the open_basedir allow list and the server is restarted.
function startSymlinkWatcher( sitePath: string ): void {
	if ( symlinkWatcher ) {
		return;
	}

	const wpContentPath = path.join( sitePath, 'wp-content' );
	const watcher = new SymlinkWatcher();
	watcher.on( 'symlink', ( target, symlinkPath ) => {
		// Covered means an existing entry already grants the target — usually the
		// site directory itself, since a site's own symlinks resolve back inside it.
		// Restarting for those would cost a request drop and buy nothing.
		if ( isCoveredByOpenBasedirAllowlist( target ) ) {
			return;
		}

		logToConsole( `Detected new symlink at ${ symlinkPath } -> ${ target }` );
		symlinkOpenBasedirAllowlist.add( target );
		scheduleAllowlistRestart();
	} );

	watcher.on( 'error', ( error ) => {
		errorToConsole( 'Symlink watcher error (will attempt to recover):', error );
	} );

	watcher.on( 'unrecoverable', ( error ) => {
		errorToConsole(
			'Symlink watcher gave up. New plugin/theme symlinks under wp-content will not be auto-allowed until the site is restarted.',
			error
		);
	} );

	watcher.on( 'restart', () => {
		// Events fired while the watcher was dead are lost. Re-scan the site and
		// rebuild the scanned half of the allowlist from what is actually on disk.
		void reconcileSymlinkAllowlist( sitePath );
	} );

	// Watch wp-content and its subdirectories for symlinks
	watcher.start( wpContentPath, 2 );
	symlinkWatcher = watcher;
}

// Rescans the site and replaces the scanned half of the allowlist, so targets that
// disappeared while the watcher was dead drop out instead of accumulating for the
// life of the server. Safe as a wholesale replacement because the scan covers a
// superset of what the watcher reports (see SYMLINK_SCAN_DEPTH).
//
// Only new grants justify a restart: without them PHP is being denied access it
// should have. A list that merely shrank is an over-grant, and restarting to
// narrow it would drop in-flight requests and reset opcache for nothing the user
// can see — the narrower list lands on the next restart that happens anyway.
async function reconcileSymlinkAllowlist( sitePath: string ): Promise< void > {
	let entries: string[];
	try {
		entries = await collectSymlinkAllowlistEntries( sitePath );
	} catch ( error ) {
		errorToConsole( 'Failed to reconcile symlink allowlist after watcher restart:', error );
		return;
	}

	symlinkOpenBasedirAllowlist = new Set( entries );

	const added = getEffectiveOpenBasedirAllowlist().filter(
		( entry ) => ! appliedOpenBasedirAllowlist.some( ( applied ) => containsPath( applied, entry ) )
	);
	if ( added.length ) {
		logToConsole( `Discovered symlink target(s) after watcher restart: ${ added.join( ', ' ) }` );
		scheduleAllowlistRestart();
	}
}

async function stopSymlinkWatcher(): Promise< void > {
	if ( symlinkRestartTimer ) {
		clearTimeout( symlinkRestartTimer );
		symlinkRestartTimer = null;
	}

	const watcher = symlinkWatcher;
	symlinkWatcher = null;
	if ( watcher ) {
		try {
			await watcher.stop();
		} catch ( error ) {
			errorToConsole( 'Failed to close symlink watcher:', error );
		}
	}
}

function scheduleAllowlistRestart(): void {
	if ( symlinkRestartTimer ) {
		clearTimeout( symlinkRestartTimer );
	}
	symlinkRestartTimer = setTimeout( () => {
		symlinkRestartTimer = null;
		logToConsole( `open_basedir extended with new symlink target(s); restarting PHP server` );
		void restartPhpServer();
	}, SYMLINK_RESTART_DEBOUNCE_MS );
}

async function restartPhpServer(): Promise< void > {
	if ( ! phpProcess || ! runningConfig ) {
		return;
	}

	await stopCurrentPhpServer();

	try {
		phpProcess = await doStartServer( runningConfig );
	} catch ( error ) {
		errorToConsole( `Failed to restart PHP server:`, error );
		process.exit( 1 );
	}
}

function getCurrentPhpProcesses(): ChildProcess[] {
	return [
		...new Set( [ phpProcess, ...phpWorkerProcesses ].filter( Boolean ) ),
	] as ChildProcess[];
}

async function closePhpProxyServer(): Promise< void > {
	const proxyServer = phpProxyServer;
	phpProxyServer = null;
	phpWorkerPorts = [];
	phpWorkerRequestTracker = new PhpWorkerRequestTracker( 0 );

	if ( ! proxyServer ) {
		return;
	}

	await new Promise< void >( ( resolve ) => {
		proxyServer.close( () => resolve() );
	} ).catch( () => {} );
}

async function stopCurrentPhpServer(): Promise< void > {
	const children = getCurrentPhpProcesses();
	phpProcess = null;
	phpWorkerProcesses = [];

	await closePhpProxyServer();
	await Promise.all(
		children.map( ( child ) => stopPhpChild( child, STOP_SERVER_TIMEOUT, errorToConsole ) )
	);
}

function proxyRequestToPhpWorker(
	config: ServerConfig,
	req: http.IncomingMessage,
	res: http.ServerResponse
): void {
	let worker: { index: number; port: number };
	try {
		worker = pickPhpWorker( req );
	} catch ( error ) {
		errorToConsole(
			`Failed to select PHP worker: ${
				error instanceof Error ? error.stack ?? error.message : String( error )
			}`
		);
		res.writeHead( 503 );
		res.end( 'Service temporarily unavailable' );
		return;
	}

	phpWorkerRequestTracker.set( worker.index, phpWorkerRequestTracker.get( worker.index ) + 1 );
	let released = false;
	const release = () => {
		if ( released ) {
			return;
		}
		released = true;
		phpWorkerRequestTracker.set( worker.index, phpWorkerRequestTracker.get( worker.index ) - 1 );
	};
	res.once( 'close', release );

	const headers = { ...req.headers };
	headers.host = req.headers.host ?? `localhost:${ config.port }`;
	delete headers.connection;
	delete headers[ 'proxy-connection' ];

	const proxyReq = http.request(
		{
			hostname: '127.0.0.1',
			port: worker.port,
			path: req.url,
			method: req.method,
			headers,
		},
		( proxyRes ) => {
			res.writeHead( proxyRes.statusCode ?? 502, proxyRes.headers );
			proxyRes.pipe( res );
		}
	);

	proxyReq.on( 'error', ( error ) => {
		release();
		if ( ! res.headersSent ) {
			res.writeHead( 502 );
		}
		res.end( `PHP worker proxy error: ${ error.message }` );
	} );

	req.pipe( proxyReq );
}

async function startPhpProxyServer(
	config: ServerConfig,
	stopSignal?: AbortSignal
): Promise< http.Server > {
	const proxyServer = http.createServer( ( req, res ) =>
		proxyRequestToPhpWorker( config, req, res )
	);

	await new Promise< void >( ( resolve, reject ) => {
		proxyServer.once( 'error', reject );
		stopSignal?.addEventListener( 'abort', () => {
			proxyServer.close();
			reject( new DOMException( 'Aborted', 'AbortError' ) );
		} );
		proxyServer.listen( config.port, 'localhost', () => {
			resolve();
		} );
	} );

	return proxyServer;
}

async function startServer( config: ServerConfig, signal: AbortSignal ): Promise< void > {
	if ( phpProcess ) {
		logToConsole( `Server already running` );
		return;
	}

	const phpVersion = resolveNativePhpVersion( config.phpVersion ?? '' );
	startupAbortController = new AbortController();
	const stopSignal = AbortSignal.any( [ signal, startupAbortController.signal ] );

	// Sites imported by `studio pull-reprint` arrive with WordPress already
	// installed and a database already in place; reprint's auto_prepend_file
	// owns their constants and SQLite wiring. So we skip wp-config rewriting,
	// the WordPress installer, and Blueprint execution — running any of them
	// against the imported database would be wrong — and just write Studio's
	// mu-plugins before starting the workers.
	const isImportedSite = Boolean( config.autoPrependFile );

	try {
		stopSignal.throwIfAborted();

		if ( ! isImportedSite ) {
			await ensureWpConfig(
				config.sitePath,
				phpVersion,
				stopSignal,
				WP_CONFIG_TRANSFORMER_PATH,
				config
			);
			stopSignal.throwIfAborted();
		}

		const muPluginsPath = await writeStudioMuPluginsForNativePhpRuntime(
			config.sitePath,
			config.isWpAutoUpdating
		);
		stopSignal.throwIfAborted();

		if ( ! isImportedSite ) {
			await installWordPress(
				config,
				phpVersion,
				stopSignal,
				SET_DEFAULT_PERMALINKS_PATH,
				logToConsole
			);
			stopSignal.throwIfAborted();

			if ( config.blueprint ) {
				await runBlueprint( config, config.blueprint, phpVersion, stopSignal );
				stopSignal.throwIfAborted();
			}
		}

		// With "all files" access the allowlist stays empty, which disables
		// open_basedir entirely (see getDefaultPhpArgs).
		if ( isFileAccessRestricted( config ) ) {
			staticOpenBasedirAllowlist.add( config.sitePath );
			staticOpenBasedirAllowlist.add( ROUTER_PATH );
			staticOpenBasedirAllowlist.add( getPhpMyAdminPath() );
			staticOpenBasedirAllowlist.add( getNativePhpMyAdminWpEnvPath( config ) );
			staticOpenBasedirAllowlist.add( getPhpMyAdminSessionPath( config ) );
			staticOpenBasedirAllowlist.add( muPluginsPath );
			staticOpenBasedirAllowlist.add( os.tmpdir() );
			if ( config.autoPrependFile ) {
				staticOpenBasedirAllowlist.add( path.dirname( config.autoPrependFile ) );
			}
			config.openBasedirAllowList?.forEach( ( entry ) => staticOpenBasedirAllowlist.add( entry ) );

			// Snapshot existing symlink targets so open_basedir grants them upfront. New
			// symlinks added while the server runs are picked up by startSymlinkWatcher
			// below and trigger a debounced restart with an extended allowlist.
			symlinkOpenBasedirAllowlist = new Set(
				await collectSymlinkAllowlistEntries( config.sitePath )
			);
			stopSignal.throwIfAborted();
		}

		runningConfig = config;

		phpProcess = await doStartServer( config, stopSignal );
		stopSignal.throwIfAborted();
		await setAdminCredentials( config, stopSignal );
		stopSignal.throwIfAborted();
	} catch ( error ) {
		killPhpProcess();
		phpProcess = null;
		await stopSymlinkWatcher();
		runningConfig = null;
		clearOpenBasedirAllowlist();

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

async function doStartServer(
	config: ServerConfig,
	stopSignal?: AbortSignal
): Promise< ChildProcess > {
	const phpVersion = resolveNativePhpVersion( config.phpVersion ?? '' );
	const spawnedChildren: ChildProcess[] = [];
	let proxyServer: http.Server | null = null;
	// Recorded before spawning so a later rescan can diff against what the workers
	// were actually given, including on the failure paths that tear the pool down.
	const openBasedirAllowlist = getEffectiveOpenBasedirAllowlist();
	appliedOpenBasedirAllowlist = openBasedirAllowlist;

	logToConsole(
		`Spawning native PHP worker pool with ${ NATIVE_PHP_WORKER_POOL_SIZE } workers on public port ${ config.port }`
	);

	try {
		const phpMyAdminWpEnvPath = await writeNativePhpMyAdminWpEnv( config );
		const siteUrl = config.absoluteUrl || `http://localhost:${ config.port }`;
		const autoPrependFile = writeSiteUrlPrependFile( siteUrl, config.autoPrependFile );
		const workerPorts: number[] = [];
		for ( let index = 0; index < NATIVE_PHP_WORKER_POOL_SIZE; index++ ) {
			workerPorts.push( await getAvailablePort() );
		}

		phpWorkerPorts = workerPorts;
		phpWorkerRequestTracker = new PhpWorkerRequestTracker( workerPorts.length );

		for ( const [ index, workerPort ] of workerPorts.entries() ) {
			const phpAddress = `127.0.0.1:${ workerPort }`;
			logToConsole(
				`Spawning PHP worker ${ index + 1 }/${ NATIVE_PHP_WORKER_POOL_SIZE } on ${ phpAddress }`
			);
			// Workers are spawned without `detached`, so they share this wrapper's process
			// group. That lets the daemon's group-kill reach every worker in one signal.
			const serverChild = spawnPhpProcess( [ '-S', phpAddress, ROUTER_PATH ], {
				phpVersion,
				siteFolder: config.sitePath,
				env: {
					STUDIO_PHPMYADMIN_PATH: getPhpMyAdminPath(),
					STUDIO_NATIVE_PHPMYADMIN_WP_ENV_PATH: phpMyAdminWpEnvPath,
					STUDIO_PHPMYADMIN_SESSION_PATH: getPhpMyAdminSessionPath( config ),
				},
				onlyPathsThatPhpCanAccess: openBasedirAllowlist,
				disallowRiskyFunctions: isFileAccessRestricted( config ),
				enableXdebug: config.enableXdebug,
				autoPrependFile,
			} );
			spawnedChildren.push( serverChild );

			// Report every worker pid to the daemon. The shared process group already lets
			// the daemon clean these up, but the individual pids give it a direct fallback.
			if ( serverChild.pid !== undefined ) {
				const message: ChildMessageRaw = {
					topic: 'server-process-started',
					data: { pid: serverChild.pid },
				};
				process.send?.( message );
			}

			await waitForChildSpawn( serverChild, stopSignal );

			serverChild.once( 'exit', ( code, signalName ) => {
				errorToConsole(
					`PHP worker ${
						index + 1
					}/${ NATIVE_PHP_WORKER_POOL_SIZE } exited unexpectedly (code: ${ code }, signal: ${ signalName })`
				);
				killAllLivePhpProcesses();
				process.exit( code ?? 1 );
			} );
		}

		stopSignal?.throwIfAborted();
		await Promise.all(
			workerPorts.map( ( workerPort ) =>
				waitForServerReady( `http://127.0.0.1:${ workerPort }/`, stopSignal )
			)
		);

		proxyServer = await startPhpProxyServer( config, stopSignal );
		phpProxyServer = proxyServer;
		phpWorkerProcesses = spawnedChildren;

		stopSignal?.throwIfAborted();
		await waitForServerReady( `http://localhost:${ config.port }/`, stopSignal );

		// Watch for symlinks created after startup. open_basedir cannot be extended
		// at runtime, so the watcher triggers a debounced restart with an updated
		// allowlist when a new symlink target is discovered. With "all files"
		// access there is no open_basedir to extend, so no watcher is needed.
		if ( isFileAccessRestricted( config ) ) {
			startSymlinkWatcher( config.sitePath );
		}
		return spawnedChildren[ 0 ];
	} catch ( error ) {
		const serverToClose = proxyServer;
		if ( serverToClose ) {
			await new Promise< void >( ( resolve ) => serverToClose.close( () => resolve() ) ).catch(
				() => {}
			);
		}
		for ( const child of spawnedChildren ) {
			child.removeAllListeners( 'exit' );
			if ( child.exitCode === null && child.signalCode === null ) {
				child.kill( 'SIGKILL' );
			}
		}
		phpWorkerPorts = [];
		phpWorkerRequestTracker = new PhpWorkerRequestTracker( 0 );
		phpWorkerProcesses = [];
		await stopSymlinkWatcher();

		throw error;
	}
}

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

	await stopSymlinkWatcher();
	runningConfig = null;
	clearOpenBasedirAllowlist();

	const children = getCurrentPhpProcesses();
	if ( children.length === 0 && ! phpProxyServer ) {
		logToConsole( 'No server running, nothing to stop' );
		return StopServerResult.OK;
	}

	if (
		children.length > 0 &&
		children.every( ( child ) => child.exitCode !== null || child.signalCode !== null ) &&
		! phpProxyServer
	) {
		logToConsole( 'Server already stopped' );
		return StopServerResult.OK;
	}

	await stopCurrentPhpServer();

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
				const blueprintPhpVersion = resolveNativePhpVersion( blueprintConfig.phpVersion ?? '' );
				await ensureWpConfig(
					blueprintConfig.sitePath,
					blueprintPhpVersion,
					abortController.signal,
					WP_CONFIG_TRANSFORMER_PATH,
					blueprintConfig
				);
				await writeStudioMuPluginsForNativePhpRuntime(
					blueprintConfig.sitePath,
					blueprintConfig.isWpAutoUpdating
				);
				await installWordPress(
					blueprintConfig,
					blueprintPhpVersion,
					abortController.signal,
					SET_DEFAULT_PERMALINKS_PATH,
					logToConsole
				);
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
	try {
		phpProxyServer?.close();
	} catch {
		// Best effort - nothing useful to do if this fails.
	}
	phpProxyServer = null;

	// Reap every PHP process we've spawned, not just the promoted servers in
	// `getCurrentPhpProcesses()` — that misses workers still mid-startup and in-flight
	// command subprocesses (install, blueprint), which would otherwise be orphaned.
	killAllLivePhpProcesses();

	phpProcess = null;
	phpWorkerProcesses = [];
	phpWorkerPorts = [];
	phpWorkerRequestTracker = new PhpWorkerRequestTracker( 0 );
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
