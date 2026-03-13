/**
 * WordPress Studio Server Child Process
 *
 * This child process is managed by the process manager daemon and runs a single WordPress site
 * server using Playground CLI. Each site runs in its own process.
 *
 * Similar to Studio's old playground-server-process-child.ts, this process:
 * - Listens for messages from the parent process (the process manager daemon)
 * - Starts WordPress server when requested
 * - Sends response back when ready
 * - Sends activity heartbeats to prevent timeout during long operations
 */
import { watch, type FSWatcher } from 'fs';
import http, { type Server as HttpServer } from 'http';
import { dirname } from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { cleanupLegacyMuPlugins, getMuPlugins } from '@studio/common/lib/mu-plugins';
import { decodePassword } from '@studio/common/lib/passwords';
import { formatPlaygroundCliMessage } from '@studio/common/lib/playground-cli-messages';
import { sequential } from '@studio/common/lib/sequential';
import { isWordPressDevVersion } from '@studio/common/lib/wordpress-version-utils';
import { BlueprintBundle } from '@wp-playground/blueprints';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import {
	FetchFilesystem,
	NodeJsFilesystem,
	OverlayFilesystem,
	InMemoryFilesystem,
} from '@wp-playground/storage';
import { WordPressInstallMode } from '@wp-playground/wordpress';
import { z } from 'zod';
import { sanitizeRunCLIArgs } from 'cli/lib/cli-args-sanitizer';
import { getSqliteCommandPath, getWpCliPharPath } from 'cli/lib/server-files';
import { isSqliteIntegrationInstalled } from 'cli/lib/sqlite-integration';
import {
	ServerConfig,
	managerMessageSchema,
	ChildMessageRaw,
} from 'cli/lib/types/wordpress-server-ipc';

let server: RunCLIServer | null = null;
let startingPromise: Promise< void > | null = null;
let lastCliArgs: Record< string, unknown > | null = null;
let orphanedServer: HttpServer | null = null;
let siteFileWatcher: FSWatcher | null = null;

// Intercept and prefix all console output from playground-cli
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = ( ...args: unknown[] ) => {
	originalConsoleLog( '[playground-cli]', ...args );
	const message = args.join( ' ' );
	process.send!( { topic: 'activity' } );
	const formattedMessage = formatPlaygroundCliMessage( message );
	if ( formattedMessage !== message ) {
		process.send!( { topic: 'console-message', message: formattedMessage } );
	}
};

console.error = ( ...args: unknown[] ) => {
	originalConsoleError( '[playground-cli]', ...args );
	process.send!( { topic: 'activity' } );
};

console.warn = ( ...args: unknown[] ) => {
	originalConsoleWarn( '[playground-cli]', ...args );
	process.send!( { topic: 'activity' } );
};

const originalStdoutWrite = process.stdout.write.bind( process.stdout );
const originalStderrWrite = process.stderr.write.bind( process.stderr );

process.stdout.write = function ( ...args: Parameters< typeof originalStdoutWrite > ) {
	process.send!( { topic: 'activity' } );
	return originalStdoutWrite( ...args );
} as typeof process.stdout.write;

process.stderr.write = function ( ...args: Parameters< typeof originalStderrWrite > ) {
	process.send!( { topic: 'activity' } );
	return originalStderrWrite( ...args );
} as typeof process.stderr.write;

function logToConsole( ...args: Parameters< typeof console.log > ) {
	originalConsoleLog( new Date().toISOString(), `[WordPress Server Child]`, ...args );
}

function errorToConsole( ...args: Parameters< typeof console.error > ) {
	originalConsoleError( new Date().toISOString(), `[WordPress Server Child]`, ...args );
}

function escapePhpString( str: string ): string {
	return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

async function setAdminCredentials(
	server: RunCLIServer,
	adminPassword?: string,
	adminUsername?: string,
	adminEmail?: string
): Promise< void > {
	await server.playground.request( {
		url: '/?studio-admin-api',
		method: 'POST',
		body: {
			action: 'set_admin_password',
			...( adminPassword && {
				password: escapePhpString( decodePassword( adminPassword ) ),
			} ),
			...( adminUsername && { username: escapePhpString( adminUsername ) } ),
			...( adminEmail && { email: escapePhpString( adminEmail ) } ),
		},
	} );
}

/**
 * Gets the WordPress installation mode based on whether WordPress files
 * and SQLite integration are present.
 *
 * @param sitePath - The path to the site
 * @returns The WordPressInstallMode to use for the site
 */
async function getWordPressInstallMode( sitePath: string ): Promise< WordPressInstallMode > {
	const hasWordPress = isWordPressDirectory( sitePath );
	const hasSqlite = await isSqliteIntegrationInstalled( sitePath );

	if ( ! hasWordPress ) {
		return 'download-and-install';
	}

	if ( hasSqlite ) {
		return 'install-from-existing-files-if-needed';
	}

	// We don't want playground to attempt installing WordPress when site is using MySQL.
	return 'do-not-attempt-installing';
}

function getBaseRunCLIArgs(
	command: 'server',
	config: ServerConfig
): Promise< RunCLIArgs & { command: 'server' } >;
function getBaseRunCLIArgs(
	command: 'run-blueprint',
	config: ServerConfig
): Promise< RunCLIArgs & { command: 'run-blueprint' } >;
async function getBaseRunCLIArgs(
	command: RunCLIArgs[ 'command' ],
	config: ServerConfig
): Promise< RunCLIArgs > {
	const wordpressInstallMode = await getWordPressInstallMode( config.sitePath );

	await cleanupLegacyMuPlugins( config.sitePath );

	const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
		isWpAutoUpdating: config.isWpAutoUpdating,
	} );

	const mounts = [
		{
			hostPath: config.sitePath,
			vfsPath: '/wordpress',
		},
		{
			hostPath: studioMuPluginsHostPath,
			vfsPath: '/internal/studio/mu-plugins',
		},
		{
			hostPath: loaderMuPluginHostPath,
			vfsPath: '/internal/shared/mu-plugins/99-studio-loader.php',
		},
		{
			hostPath: getWpCliPharPath(),
			vfsPath: '/tmp/wp-cli.phar',
		},
		{
			hostPath: getSqliteCommandPath(),
			vfsPath: '/tmp/sqlite-command',
		},
	];

	const enableDebugLog = config.enableDebugLog ?? false;
	const enableDebugDisplay = config.enableDebugDisplay ?? false;

	const defaultConstants: Record< string, boolean > = {
		WP_SQLITE_AST_DRIVER: true,
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
	};

	let blueprintBundle: BlueprintBundle | undefined;

	// Build blueprint contents with preferredVersions to ensure PHP version is respected
	// This is necessary because @wp-playground/cli only reads preferredVersions from the blueprint
	// when a BlueprintBundle is provided (rather than merging args.php into the blueprint)
	// Precedence: 1) Studio config (explicit setting), 2) Blueprint's preferredVersions, 3) Default
	const preferredVersions: { php: string; wp: string } = {
		php:
			config.phpVersion || config.blueprint?.contents.preferredVersions?.php || DEFAULT_PHP_VERSION,
		wp: config.wpVersion || config.blueprint?.contents.preferredVersions?.wp || 'latest',
	};

	if ( config.blueprint ) {
		config.blueprint.contents.constants = {
			...config.blueprint.contents.constants,
			...defaultConstants,
		};
		config.blueprint.contents.preferredVersions = preferredVersions;
		const blueprintFs = new InMemoryFilesystem( {
			'blueprint.json': JSON.stringify( config.blueprint.contents ),
		} );

		if (
			config.blueprint.uri.startsWith( 'http://' ) ||
			config.blueprint.uri.startsWith( 'https://' )
		) {
			blueprintBundle = new OverlayFilesystem( [
				blueprintFs,
				new FetchFilesystem( { baseUrl: config.blueprint.uri } ),
			] );
		} else {
			blueprintBundle = new OverlayFilesystem( [
				blueprintFs,
				new NodeJsFilesystem( dirname( config.blueprint.uri ) ),
			] );
		}
	} else {
		blueprintBundle = new InMemoryFilesystem( {
			'blueprint.json': JSON.stringify( {
				constants: defaultConstants,
				preferredVersions,
			} ),
		} );
	}

	const args: RunCLIArgs = {
		command,
		internalCookieStore: false,
		login: false,
		followSymlinks: true,
		skipSqliteSetup: true,
		port: config.port,
		'mount-before-install': mounts,
		'site-url': config.absoluteUrl || `http://localhost:${ config.port }`,
		blueprint: blueprintBundle,
		wordpressInstallMode,
		redis: true,
		memcached: true,
	};

	if ( config.wpVersion ) {
		if ( isWordPressDevVersion( config.wpVersion ) ) {
			args.wp = 'nightly';
		} else {
			args.wp = config.wpVersion;
		}
	}

	if ( config.enableXdebug ) {
		logToConsole( 'Enabling Xdebug support' );
		args.xdebug = true;
	}

	return args;
}

function wrapWithStartingPromise< Args extends unknown[], Return extends void >(
	callback: ( ...args: Args ) => Promise< Return >
) {
	return async ( ...args: Args ) => {
		startingPromise = callback( ...args );
		return startingPromise;
	};
}

/**
 * Determines if an error from runCLI() is caused by user PHP code (themes/plugins)
 * rather than an infrastructure issue (WASM memory, port conflicts, etc.).
 */
function isPhpUserError( error: unknown ): boolean {
	if ( ! ( error instanceof Error ) ) {
		return false;
	}

	const message = error.message;

	// Infrastructure errors — should NOT trigger fallback
	if (
		message.includes( 'Cannot allocate Wasm memory' ) ||
		message.includes( 'EADDRINUSE' ) ||
		message.includes( 'Operation aborted' ) ||
		message.includes( '"unreachable" WASM instruction' )
	) {
		return false;
	}

	// PHP user errors — should trigger fallback
	if ( message.match( /PHP Fatal error:/i ) ) {
		return true;
	}
	if ( message.match( /Fatal error/i ) ) {
		return true;
	}
	if ( message.includes( 'wp-die-message' ) ) {
		return true;
	}
	if ( message.includes( 'PHP.run() failed with exit code' ) ) {
		return true;
	}
	// Intercepted process.exit(1) from @wp-playground/cli during server startup
	if ( message.includes( 'WordPress server startup failed' ) ) {
		return true;
	}

	return false;
}

function generateErrorPageHtml( errorMessage: string ): string {
	const escaped = errorMessage
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PHP Error</title>
<style>html{background:#f1f1f1}body{background:#fff;border:1px solid #ccd0d4;color:#444;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:2em auto;padding:1em 2em;max-width:700px}h1{color:#d63638;font-size:1.3em}pre{background:#f6f7f7;border:1px solid #dcdcde;padding:1em;white-space:pre-wrap;word-wrap:break-word;font-size:13px}.info{background:#f0f6fc;border-left:4px solid #72aee6;padding:12px 16px;margin:1.5em 0}</style>
</head><body><h1>PHP Error Detected</h1><pre>${ escaped }</pre>
<div class="info"><p><strong>Studio is watching for file changes.</strong> Fix the PHP error and the site will automatically restart.</p></div></body></html>`;
}

/**
 * Replaces the request handler on an HTTP server to serve an error page.
 */
function serveErrorPage( httpServer: HttpServer, errorMessage: string ): void {
	const html = generateErrorPageHtml( errorMessage );
	httpServer.removeAllListeners( 'request' );
	httpServer.on( 'request', ( _req, res ) => {
		res.writeHead( 500, { 'Content-Type': 'text/html; charset=utf-8' } );
		res.end( html );
	} );
}

/**
 * Watch for PHP file changes and attempt to restart the server.
 */
function watchForPhpChanges( config: ServerConfig ): void {
	let debounce: ReturnType< typeof setTimeout > | null = null;
	let retrying = false;

	siteFileWatcher = watch( config.sitePath, { recursive: true }, ( _event, filename ) => {
		if ( ! filename?.endsWith( '.php' ) || retrying ) {
			return;
		}
		if ( debounce ) {
			clearTimeout( debounce );
		}
		debounce = setTimeout( () => {
			void ( async () => {
				retrying = true;
				logToConsole( 'PHP file change detected, restarting server…' );
				try {
					// Close orphaned server to free the port for the new runCLI
					if ( orphanedServer ) {
						orphanedServer.close();
						orphanedServer = null;
					}
					const args = await getBaseRunCLIArgs( 'server', config );
					lastCliArgs = sanitizeRunCLIArgs( args );
					server = await runCLIWithoutExit( args );

					// Success — clean up watcher
					siteFileWatcher?.close();
					siteFileWatcher = null;
					logToConsole( 'Server restarted successfully' );

					if ( config.adminPassword || config.adminUsername || config.adminEmail ) {
						await setAdminCredentials(
							server,
							config.adminPassword,
							config.adminUsername,
							config.adminEmail
						);
					}
				} catch {
					// runCLIWithoutExit already repurposed the orphaned server with new error
					logToConsole( 'Restart failed, still watching…' );
				} finally {
					retrying = false;
				}
			} )();
		}, 2000 );
	} );
}

/**
 * Wraps runCLI to prevent @wp-playground/cli from calling process.exit(1) on
 * PHP fatal errors, and to capture orphaned HTTP servers for reuse.
 *
 * Playground's internal error handler calls process.exit(1) directly in a .catch(),
 * bypassing all try-catch blocks. This wrapper:
 * 1. Overrides process.exit to throw instead of exiting
 * 2. Captures stdout/console output so we get the actual PHP error message
 * 3. Intercepts http.createServer to capture Playground's HTTP server reference
 * 4. On failure, repurposes the orphaned server to serve an error page
 */
async function runCLIWithoutExit(
	args: RunCLIArgs & { command: 'server' }
): Promise< RunCLIServer > {
	const originalExit = process.exit;
	const capturedOutput: string[] = [];

	// Capture all output channels — PHP WASM writes errors via process.stdout.write,
	// while Playground's printError uses console.log/error.
	const savedConsoleLog = console.log;
	const savedConsoleError = console.error;
	const savedStdoutWrite = process.stdout.write;
	console.log = ( ...logArgs: unknown[] ) => {
		capturedOutput.push( logArgs.map( String ).join( ' ' ) );
		savedConsoleLog( ...logArgs );
	};
	console.error = ( ...errorArgs: unknown[] ) => {
		capturedOutput.push( errorArgs.map( String ).join( ' ' ) );
		savedConsoleError( ...errorArgs );
	};
	process.stdout.write = function ( ...writeArgs: Parameters< typeof savedStdoutWrite > ) {
		capturedOutput.push( String( writeArgs[ 0 ] ) );
		return savedStdoutWrite( ...writeArgs );
	} as typeof process.stdout.write;

	process.exit = ( ( code?: number ) => {
		if ( code !== 0 ) {
			const errorMsg =
				capturedOutput.join( '\n' ) || `WordPress server startup failed (exit code ${ code })`;
			throw new Error( errorMsg );
		}
		return originalExit( code );
	} ) as typeof process.exit;

	// Intercept HTTP servers created by Playground so we can repurpose them on failure.
	// Playground binds an HTTP server to the port before booting WordPress — if boot fails,
	// this orphaned server still holds the port.
	const createdServers: HttpServer[] = [];
	const originalCreateServer = http.createServer;
	http.createServer = ( ( ...createArgs: unknown[] ) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const srv = ( originalCreateServer as any )( ...createArgs ) as HttpServer;
		createdServers.push( srv );
		return srv;
	} ) as typeof http.createServer;

	try {
		return await runCLI( args );
	} catch ( error ) {
		// Repurpose Playground's orphaned HTTP server to serve our error page.
		// This avoids EADDRINUSE — the server is already bound to the port.
		if ( createdServers.length > 0 ) {
			const srv = createdServers[ 0 ];
			serveErrorPage( srv, parsePhpError( error ) );
			orphanedServer = srv;
			// Close any extra servers (unlikely, but be safe)
			for ( let i = 1; i < createdServers.length; i++ ) {
				createdServers[ i ].close();
			}
		}
		throw error;
	} finally {
		process.exit = originalExit;
		console.log = savedConsoleLog;
		console.error = savedConsoleError;
		process.stdout.write = savedStdoutWrite;
		http.createServer = originalCreateServer;
	}
}

const startServer = wrapWithStartingPromise(
	async ( config: ServerConfig, signal: AbortSignal ): Promise< void > => {
		if ( server ) {
			logToConsole( `Server already running for site ${ config.siteId }` );
			return;
		}

		try {
			signal.addEventListener(
				'abort',
				() => {
					throw new Error( 'Operation aborted' );
				},
				{ once: true }
			);

			const args = await getBaseRunCLIArgs( 'server', config );
			lastCliArgs = sanitizeRunCLIArgs( args );
			server = await runCLIWithoutExit( args );

			if ( config.adminPassword || config.adminUsername || config.adminEmail ) {
				await setAdminCredentials(
					server,
					config.adminPassword,
					config.adminUsername,
					config.adminEmail
				);
			}
		} catch ( error ) {
			server = null;

			if ( isPhpUserError( error ) ) {
				logToConsole( `PHP error detected during startup: ${ parsePhpError( error ) }` );
				// orphanedServer is already serving the error page (set by runCLIWithoutExit)
				watchForPhpChanges( config );
				return;
			}

			errorToConsole( `Failed to start server:`, error );
			throw error;
		}
	}
);

const STOP_SERVER_TIMEOUT = 5000;

async function stopServer(): Promise< void > {
	if ( siteFileWatcher ) {
		siteFileWatcher.close();
		siteFileWatcher = null;
	}
	if ( orphanedServer ) {
		orphanedServer.close();
		orphanedServer = null;
		logToConsole( 'Error page server stopped' );
		return;
	}

	if ( ! server ) {
		logToConsole( 'No server running, nothing to stop' );
		return;
	}

	const serverToDispose = server;
	server = null;

	try {
		const disposalTimeout = new Promise< void >( ( _, reject ) =>
			setTimeout( () => reject( new Error( 'Server disposal timeout' ) ), STOP_SERVER_TIMEOUT )
		);

		await Promise.race( [ serverToDispose[ Symbol.asyncDispose ](), disposalTimeout ] );
		logToConsole( 'Server stopped gracefully' );
	} catch ( error ) {
		errorToConsole( 'Error during server disposal:', error );
	}
}

async function runBlueprint( config: ServerConfig, signal: AbortSignal ): Promise< void > {
	try {
		signal.addEventListener(
			'abort',
			() => {
				throw new Error( 'Operation aborted' );
			},
			{ once: true }
		);

		const args = await getBaseRunCLIArgs( 'run-blueprint', config );
		lastCliArgs = sanitizeRunCLIArgs( args );
		await runCLI( args );

		logToConsole( `Blueprint applied successfully for site ${ config.siteId }` );
	} catch ( error ) {
		errorToConsole( `Failed to run Blueprint:`, error );
		throw error;
	}
}

const runWpCliCommand = sequential(
	async (
		args: string[],
		signal: AbortSignal
	): Promise< { stdout: string; stderr: string; exitCode: number } > => {
		await Promise.allSettled( [ startingPromise ] );

		if ( ! server ) {
			throw new Error( `Failed to run WP CLI command because server is not running` );
		}

		signal.addEventListener(
			'abort',
			() => {
				throw new Error( 'Operation aborted' );
			},
			{ once: true }
		);

		const response = await server.playground.cli( [
			'php',
			'/tmp/wp-cli.phar',
			`--path=${ await server.playground.documentRoot }`,
			...args,
		] );

		return {
			stdout: await response.stdoutText,
			stderr: await response.stderrText,
			exitCode: await response.exitCode,
		};
	},
	{ concurrent: 3, max: 100, deduplicateKey: ( args: string[] ) => args.join( ' ' ) }
);

function parsePhpError( error: unknown ): string {
	if ( ! ( error instanceof Error ) ) {
		return String( error );
	}

	const message = error.message;

	// Check for WordPress critical error in HTML output
	const wpDieMatch = message.match( /<div class="wp-die-message"[^>]*>([\s\S]*?)<\/div>/ );
	if ( wpDieMatch ) {
		// Extract text from HTML, removing tags
		const htmlContent = wpDieMatch[ 1 ];
		const textContent = htmlContent
			.replace( /<[^>]+>/g, ' ' )
			.replace( /\s+/g, ' ' )
			.trim();
		if ( textContent ) {
			return `WordPress error: ${ textContent }`;
		}
	}

	// Check for PHP fatal error pattern
	const fatalMatch = message.match( /PHP Fatal error:\s*(.+?)(?:\sin\s|$)/i );
	if ( fatalMatch ) {
		return `PHP Fatal error: ${ fatalMatch[ 1 ].trim() }`;
	}

	// Check for generic PHP.run() failure - provide a cleaner message
	if ( message.includes( 'PHP.run() failed with exit code' ) ) {
		const exitCodeMatch = message.match( /exit code (\d+)/ );
		const exitCode = exitCodeMatch ? exitCodeMatch[ 1 ] : 'unknown';
		return `WordPress failed to start (PHP exit code ${ exitCode }). Check the site's debug.log for details.`;
	}

	return message;
}

function sendErrorMessage( messageId: string, error: unknown ) {
	const errorResponse: ChildMessageRaw = {
		originalMessageId: messageId,
		topic: 'error',
		errorMessage: parsePhpError( error ),
		errorStack: error instanceof Error ? error.stack : undefined,
		cliArgs: lastCliArgs ?? undefined,
	};
	process.send!( errorResponse );
}

const abortControllers: Record< string, AbortController > = {};

async function ipcMessageHandler( packet: unknown ) {
	const messageResult = managerMessageSchema.safeParse( packet );

	if ( ! messageResult.success ) {
		errorToConsole( 'Invalid message received:', messageResult.error );

		const minimalMessageSchema = z.object( { id: z.string() } );
		const minimalMessage = minimalMessageSchema.safeParse( packet );
		if ( minimalMessage.success ) {
			sendErrorMessage( minimalMessage.data.id, messageResult.error );
		}
		return;
	}

	const validMessage = messageResult.data;
	if ( validMessage.topic !== 'abort' ) {
		abortControllers[ validMessage.messageId ] = new AbortController();
	}
	const abortController = abortControllers[ validMessage.messageId ];

	try {
		let result: unknown;

		switch ( validMessage.topic ) {
			case 'abort':
				abortController?.abort();
				delete abortControllers[ validMessage.messageId ];
				return;
			case 'start-server':
				result = await startServer( validMessage.data.config, abortController.signal );
				break;
			case 'run-blueprint':
				result = await runBlueprint( validMessage.data.config, abortController.signal );
				break;
			case 'stop-server':
				result = await stopServer();
				break;
			case 'wp-cli-command':
				try {
					result = await runWpCliCommand( validMessage.data.args, abortController.signal );
				} catch ( wpCliError ) {
					errorToConsole( `WP-CLI error:`, wpCliError );
					sendErrorMessage( validMessage.messageId, wpCliError );
					return; // Don't crash, just return error to caller
				}
				break;
			default:
				throw new Error( `Unknown message.` );
		}

		const response: ChildMessageRaw = {
			originalMessageId: validMessage.messageId,
			topic: 'result',
			result,
		};
		process.send!( response );
	} catch ( error ) {
		errorToConsole( `Error handling message ${ validMessage.topic }:`, error );
		sendErrorMessage( validMessage.messageId, error );
		process.exit( 1 );
	}
}

// Prevent the process from crashing on unhandled errors from worker threads
// (e.g., PHP WASM fatal errors). These are handled by the startServer catch block
// via the runCLI() promise rejection, but worker thread errors can also surface
// as separate unhandled rejections that would otherwise crash the process.
process.on( 'uncaughtException', ( error ) => {
	errorToConsole( 'Uncaught exception in child process:', error );
} );

process.on( 'unhandledRejection', ( reason ) => {
	errorToConsole( 'Unhandled rejection in child process:', reason );
} );

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
