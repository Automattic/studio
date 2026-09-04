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
import { rootCertificates } from 'node:tls';
import path, { dirname } from 'path';
import { setPhpIniEntries } from '@php-wasm/universal';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { IS_JSPI_AVAILABLE } from '@studio/common/lib/jspi';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import {
	cleanupLegacyMuPlugins,
	getMuPlugins,
	STUDIO_ERROR_LOG_FILENAME,
} from '@studio/common/lib/mu-plugins';
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
import fs from 'fs-extra';
import { z } from 'zod';
import {
	requestSetAdminCredentials,
	SetAdminCredentialsRequest,
	SetAdminCredentialsRequestBody,
} from 'cli/lib/admin-credentials';
import { sanitizeRunCLIArgs } from 'cli/lib/cli-args-sanitizer';
import {
	getPhpMyAdminPath,
	getSqliteCommandPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { rewriteWpCliPostContentToFile } from 'cli/lib/rewrite-wp-cli-post-content';
import { isSqliteIntegrationInstalled } from 'cli/lib/sqlite-integration';
import {
	ServerConfig,
	managerMessageSchema,
	ChildMessageRaw,
} from 'cli/lib/types/wordpress-server-ipc';

let server: RunCLIServer | null = null;
let lastCliArgs: Record< string, unknown > | null = null;

/**
 * Best-effort notification to the daemon. Once the IPC channel is closed (the daemon is gone or
 * asked us to stop), `process.send` would emit an 'error' on `process`; the uncaughtException
 * handler below logs that to stderr, and stderr writes report activity, so the child would loop
 * forever writing stack traces. Skip the send instead, and route any late failure to a callback.
 */
function notifyDaemon(
	message: { topic: 'activity' } | { topic: 'console-message'; message: string }
) {
	if ( ! process.connected ) {
		return;
	}
	process.send!( message, () => {
		// The channel can close between the check and the send; nothing useful to do.
	} );
}

// Intercept and prefix all console output from playground-cli
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = ( ...args: unknown[] ) => {
	originalConsoleLog( '[playground-cli]', ...args );
	const message = args.join( ' ' );
	notifyDaemon( { topic: 'activity' } );
	const formattedMessage = formatPlaygroundCliMessage( message );
	if ( formattedMessage !== message ) {
		notifyDaemon( { topic: 'console-message', message: formattedMessage } );
	}
};

console.error = ( ...args: unknown[] ) => {
	originalConsoleError( '[playground-cli]', ...args );
	notifyDaemon( { topic: 'activity' } );
};

console.warn = ( ...args: unknown[] ) => {
	originalConsoleWarn( '[playground-cli]', ...args );
	notifyDaemon( { topic: 'activity' } );
};

const originalStdoutWrite = process.stdout.write.bind( process.stdout );
const originalStderrWrite = process.stderr.write.bind( process.stderr );

process.stdout.write = function ( ...args: Parameters< typeof originalStdoutWrite > ) {
	notifyDaemon( { topic: 'activity' } );
	return originalStdoutWrite( ...args );
} as typeof process.stdout.write;

process.stderr.write = function ( ...args: Parameters< typeof originalStderrWrite > ) {
	notifyDaemon( { topic: 'activity' } );
	return originalStderrWrite( ...args );
} as typeof process.stderr.write;

function logToConsole( ...args: Parameters< typeof console.log > ) {
	originalConsoleLog( `[Playground Server]`, ...args );
}

function errorToConsole( ...args: Parameters< typeof console.error > ) {
	originalConsoleError( `[Playground Server]`, ...args );
}

function escapePhpString( str: string ): string {
	return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

async function setAdminCredentials( server: RunCLIServer, config: ServerConfig ): Promise< void > {
	await requestSetAdminCredentials( config, async ( request ) => {
		await server.playground.request( escapeRequestForPlayground( request ) );
	} );
}

function escapeRequestForPlayground(
	request: SetAdminCredentialsRequest
): SetAdminCredentialsRequest {
	return {
		...request,
		body: escapeRequestBodyForPlayground( request.body ),
	};
}

function escapeRequestBodyForPlayground(
	body: SetAdminCredentialsRequestBody
): SetAdminCredentialsRequestBody {
	return Object.fromEntries(
		Object.entries( body ).map( ( [ key, value ] ) => [ key, escapePhpString( value ) ] )
	) as SetAdminCredentialsRequestBody;
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

function buildSetupSteps( config: ServerConfig ): Array< Record< string, unknown > > {
	const steps: Array< Record< string, unknown > > = [];

	const siteLanguage = config.siteLanguage;
	if ( siteLanguage && siteLanguage !== DEFAULT_LOCALE ) {
		// If copyLanguagePackToSite already copied bundled packs, use defineWpConfigConsts
		// (no network needed). Otherwise fall back to setSiteLanguage which downloads them.
		const langFile = path.join(
			config.sitePath,
			'wp-content',
			'languages',
			`${ siteLanguage }.l10n.php`
		);
		if ( fs.existsSync( langFile ) ) {
			steps.push(
				{ step: 'defineWpConfigConsts', consts: { WPLANG: siteLanguage } },
				{ step: 'setSiteOptions', options: { WPLANG: siteLanguage } }
			);
		} else {
			steps.push(
				{ step: 'setSiteLanguage', language: siteLanguage },
				{ step: 'setSiteOptions', options: { WPLANG: siteLanguage } }
			);
		}
	}

	// Set blogname for new sites only (where WordPress hasn't been installed yet)
	const isNewSite =
		! isWordPressDirectory( config.sitePath ) ||
		! fs.existsSync( path.join( config.sitePath, 'wp-config.php' ) );
	if ( config.siteTitle && isNewSite ) {
		steps.push( { step: 'setSiteOptions', options: { blogname: config.siteTitle } } );
	}

	return steps;
}

function blueprintInjectsWpCliPhar( config: ServerConfig ): boolean {
	const contents = config.blueprint?.contents;
	const steps = contents?.steps;
	const extraLibraries = ( contents as { extraLibraries?: unknown } | undefined )?.extraLibraries;
	const hasTriggeringStep =
		Array.isArray( steps ) &&
		steps.some(
			( step ) =>
				typeof step === 'object' &&
				step !== null &&
				'step' in step &&
				( step.step === 'wp-cli' || step.step === 'enableMultisite' )
		);
	const wpCliInExtraLibraries =
		Array.isArray( extraLibraries ) && extraLibraries.includes( 'wp-cli' );

	return hasTriggeringStep || wpCliInExtraLibraries;
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
	const wordpressInstallMode =
		config.wordpressInstallMode ?? ( await getWordPressInstallMode( config.sitePath ) );
	const useExactMountLayout = config.useExactMountLayout ?? false;
	let mountsBeforeInstall = [ ...( config.mountsBeforeInstall ?? [] ) ];
	const mounts = [ ...( config.mounts ?? [] ) ];

	await cleanupLegacyMuPlugins( config.sitePath );

	const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
		isWpAutoUpdating: config.isWpAutoUpdating,
		errorLogPath: config.enableDebugLog
			? '/wordpress/wp-content/debug.log'
			: `/wordpress/wp-content/${ STUDIO_ERROR_LOG_FILENAME }`,
		errorLogStopAfterBoot: ! config.enableDebugLog,
	} );

	if ( ! useExactMountLayout ) {
		const shouldMountBundledWpCli = ! blueprintInjectsWpCliPhar( config );
		mountsBeforeInstall = [
			...( config.mountsBeforeInstall ?? [
				{
					hostPath: config.sitePath,
					vfsPath: '/wordpress',
				},
			] ),
			...( shouldMountBundledWpCli
				? [
						{
							hostPath: getWpCliPharPath(),
							vfsPath: '/tmp/wp-cli.phar',
						},
				  ]
				: [] ),
			{
				hostPath: getSqliteCommandPath(),
				vfsPath: '/tmp/sqlite-command',
			},
		];

		if ( ! shouldMountBundledWpCli ) {
			logToConsole(
				'Skipping bundled WP-CLI mount because Playground injects /tmp/wp-cli.phar for this Blueprint'
			);
		}
	}

	// Studio MU-plugins (auto-login, admin-api, etc.) must be mounted for
	// all sites including imported ones that use an exact mount layout.
	mountsBeforeInstall.push(
		{
			hostPath: studioMuPluginsHostPath,
			vfsPath: '/internal/studio/mu-plugins',
		},
		{
			hostPath: loaderMuPluginHostPath,
			vfsPath: '/internal/shared/mu-plugins/99-studio-loader.php',
		}
	);

	const enableDebugLog = config.enableDebugLog ?? false;
	const enableDebugDisplay = config.enableDebugDisplay ?? false;

	const defaultConstants: Record< string, boolean | string > = {
		// Fallback for sites where DB_NAME was stripped from wp-config.php.
		// The SQLite driver (v3+) requires a non-empty DB_NAME at runtime.
		DB_NAME: 'wordpress',
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

		const setupSteps = buildSetupSteps( config );
		if ( setupSteps.length > 0 ) {
			const existingSteps = Array.isArray( config.blueprint.contents.steps )
				? config.blueprint.contents.steps
				: [];
			config.blueprint.contents.steps = [ ...setupSteps, ...existingSteps ];
		}

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
		const setupSteps = buildSetupSteps( config );
		blueprintBundle = new InMemoryFilesystem( {
			'blueprint.json': JSON.stringify( {
				constants: defaultConstants,
				preferredVersions,
				...( setupSteps.length > 0 ? { steps: setupSteps } : {} ),
			} ),
		} );
	}

	const args: RunCLIArgs = {
		command,
		internalCookieStore: false,
		login: false,
		followSymlinks: true,
		skipSqliteSetup: config.skipSqliteSetup ?? ! useExactMountLayout,
		port: config.port,
		'mount-before-install': mountsBeforeInstall,
		...( mounts.length > 0 ? { mount: mounts } : {} ),
		'site-url': config.absoluteUrl || `http://localhost:${ config.port }`,
		blueprint: blueprintBundle,
		wordpressInstallMode,
		redis: IS_JSPI_AVAILABLE,
		memcached: IS_JSPI_AVAILABLE,
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

	if ( ! useExactMountLayout ) {
		const phpMyAdminHostPath = getPhpMyAdminPath();
		if ( await fs.pathExists( phpMyAdminHostPath ) ) {
			mountsBeforeInstall.push( {
				hostPath: phpMyAdminHostPath,
				vfsPath: '/tools/phpmyadmin',
			} );
			logToConsole( 'Mounting bundled phpMyAdmin' );
		} else {
			logToConsole( 'Bundled phpMyAdmin not found, falling back to Playground download' );
		}
		args.phpmyadmin = true;
	}

	lastCliArgs = sanitizeRunCLIArgs( args );
	return args;
}

let startupAbortController: AbortController | null = null;
let startingPromise: Promise< void > | null = null;

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

const startServer = wrapWithStartingPromise(
	async ( config: ServerConfig, signal: AbortSignal ): Promise< void > => {
		if ( server ) {
			logToConsole( `Server already running for site ${ config.siteId }` );
			return;
		}

		startupAbortController = new AbortController();
		const stopSignal = AbortSignal.any( [ signal, startupAbortController.signal ] );

		try {
			stopSignal.throwIfAborted();

			const args = await getBaseRunCLIArgs( 'server', config );

			server = await runCLI( args );

			stopSignal.throwIfAborted();

			// Playground CLI only writes the CA bundle when booting a fresh WordPress install; set it here for existing sites too (#3153).
			await server.playground.writeFile(
				'/internal/shared/ca-bundle.crt',
				rootCertificates.join( '\n' )
			);
			await setPhpIniEntries( server.playground, {
				'openssl.cafile': '/internal/shared/ca-bundle.crt',
				'curl.cainfo': '/internal/shared/ca-bundle.crt',
				memory_limit: '512M',
			} );

			stopSignal.throwIfAborted();

			await setAdminCredentials( server, config );

			stopSignal.throwIfAborted();
		} catch ( error ) {
			if ( server ) {
				await server[ Symbol.asyncDispose ]();
				server = null;
			}

			if ( error instanceof Error && error.name === 'AbortError' ) {
				logToConsole( `Aborted start server operation:`, error );
			} else {
				errorToConsole( `Failed to start server:`, error );
			}

			// Rethrowing the error so that `ipcMessageHandler` returns an error IPC response and kills the process
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
	// If there's a startup in progress, abort and return gracefully. The `startServer` function will
	// throw because of the aborted signal, leading `ipcMessageHandler` to return an error IPC
	// response and killing the process.
	if ( startupAbortController ) {
		logToConsole( 'Startup operation in progress. Aborting it to stop the server…' );
		startupAbortController.abort();
		return StopServerResult.ABORTED_STARTUP;
	}

	// If there's no `startupAbortController` and no `server` instance, then it's likely the client
	// never sent a `start-server` message. Return gracefully so `ipcMessageHandler` can disconnect
	// IPC and allow the process to (hopefully) exit cleanly.
	if ( ! server ) {
		logToConsole( 'No server running, nothing to stop' );
		return StopServerResult.OK;
	}

	try {
		const disposalTimeout = new Promise< void >( ( _, reject ) =>
			setTimeout( () => reject( new Error( 'Server disposal timeout' ) ), STOP_SERVER_TIMEOUT )
		);

		await Promise.race( [ server[ Symbol.asyncDispose ](), disposalTimeout ] );
		logToConsole( 'Server stopped gracefully' );
		return StopServerResult.OK;
	} catch ( error ) {
		errorToConsole( 'Error during server disposal:', error );
		// Rethrowing the error so that `ipcMessageHandler` returns an error IPC response and kills the process
		throw error;
	} finally {
		server = null;
	}
}

async function runBlueprint( config: ServerConfig, signal: AbortSignal ): Promise< void > {
	try {
		signal.throwIfAborted();

		const args = await getBaseRunCLIArgs( 'run-blueprint', config );
		await runCLI( args );

		signal.throwIfAborted();

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

		logToConsole( `Running WP-CLI command:`, args );

		signal.addEventListener(
			'abort',
			() => {
				throw new Error( 'Operation aborted' );
			},
			{ once: true }
		);

		const rewrittenArgs = await rewriteWpCliPostContentToFile( args, server.playground.writeFile );

		const response = await server.playground.cli( [
			'php',
			'/tmp/wp-cli.phar',
			`--path=${ await server.playground.documentRoot }`,
			...rewrittenArgs,
		] );

		return {
			stdout: await response.stdoutText,
			stderr: await response.stderrText,
			exitCode: await response.exitCode,
		};
	},
	{ concurrent: 3, max: 100, deduplicateKey: ( args ) => args.join( ' ' ) }
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

function sendErrorMessage( messageId: string, error: unknown ): Promise< void > {
	return new Promise( ( resolve ) => {
		const errorResponse: ChildMessageRaw = {
			originalMessageId: messageId,
			topic: 'error',
			errorMessage: parsePhpError( error ),
			errorStack: error instanceof Error ? error.stack : undefined,
			cliArgs: lastCliArgs ?? undefined,
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
					await sendErrorMessage( validMessage.messageId, wpCliError );
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

		// If the `stopServer` function ran successfully, the last open handle should be the IPC channel.
		// Disconnect so that the process can exit cleanly.
		if ( validMessage.topic === 'stop-server' && result === StopServerResult.OK ) {
			process.disconnect();
		}
	} catch ( error ) {
		errorToConsole( `Error handling message ${ validMessage.topic }:`, error );
		await sendErrorMessage( validMessage.messageId, error );
		originalConsoleLog( 'Killing process because of', error );
		process.exit( 1 );
	} finally {
		delete abortControllers[ validMessage.messageId ];
	}
}

// A PHP WASM worker hitting a fatal error can surface as a stray unhandled rejection in addition to
// the runCLI() rejection that startServer already handles. Log instead of letting it crash the child,
// so the clean error-reporting path runs and the PHP error reaches the main process for recovery.
process.on( 'uncaughtException', ( error ) => {
	errorToConsole( 'Uncaught exception in child process:', error );
} );

process.on( 'unhandledRejection', ( reason ) => {
	errorToConsole( 'Unhandled rejection in child process:', reason );
} );

// On Windows the daemon has no SIGTERM equivalent, so it asks a child to stop by closing the IPC
// channel. Without this handler the process lingered until the daemon force-killed it 2.5 s
// later, which can interrupt a SQLite write mid-flight.
process.on( 'disconnect', () => {
	logToConsole( 'IPC channel disconnected, shutting down' );
	const forceExitTimer = setTimeout( () => process.exit( 1 ), STOP_SERVER_TIMEOUT + 1_000 );
	void stopServer()
		.catch( ( error ) => errorToConsole( 'Failed to stop server on disconnect:', error ) )
		.finally( () => {
			clearTimeout( forceExitTimer );
			process.exit( 0 );
		} );
} );

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
