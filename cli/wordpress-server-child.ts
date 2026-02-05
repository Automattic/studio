/**
 * WordPress Studio Server Child Process
 *
 * This child process is managed by PM2 and runs a single WordPress site server
 * using the Playground CLI provider. Each site runs in its own PM2 process.
 *
 * Similar to Studio's playground-server-process-child.ts, this process:
 * - Listens for messages from the parent process (PM2)
 * - Starts WordPress server when requested
 * - Sends response back when ready
 * - Sends activity heartbeats to prevent timeout during long operations
 */
import { cpus } from 'os';
import { dirname } from 'path';
import { BlueprintBundle } from '@wp-playground/blueprints';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import {
	FetchFilesystem,
	NodeJsFilesystem,
	OverlayFilesystem,
	InMemoryFilesystem,
} from '@wp-playground/storage';
import { WordPressInstallMode } from '@wp-playground/wordpress';
import { DEFAULT_PHP_VERSION } from 'common/constants';
import { isWordPressDirectory } from 'common/lib/fs-utils';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { decodePassword } from 'common/lib/passwords';
import { formatPlaygroundCliMessage } from 'common/lib/playground-cli-messages';
import { sequential } from 'common/lib/sequential';
import { isWordPressDevVersion } from 'common/lib/wordpress-version-utils';
import { isSqliteInstalled } from 'src/lib/sqlite-versions';
import { z } from 'zod';
import { sanitizeRunCLIArgs } from 'cli/lib/cli-args-sanitizer';
import { getSqliteCommandPath, getWpCliPharPath } from 'cli/lib/server-files';
import {
	ServerConfig,
	managerMessageSchema,
	ChildMessageRaw,
} from 'cli/lib/types/wordpress-server-ipc';

let server: RunCLIServer | null = null;
let startingPromise: Promise< void > | null = null;
let lastCliArgs: Record< string, unknown > | null = null;

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

async function setAdminPassword( server: RunCLIServer, adminPassword: string ): Promise< void > {
	await server.playground.request( {
		url: '/?studio-admin-api',
		method: 'POST',
		body: {
			action: 'set_admin_password',
			password: escapePhpString( decodePassword( adminPassword ) ),
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
	const hasSqlite = await isSqliteInstalled( sitePath );

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

	const defaultConstants = {
		WP_SQLITE_AST_DRIVER: true,
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
	};

	if ( config.wpVersion ) {
		if ( isWordPressDevVersion( config.wpVersion ) ) {
			args.wp = 'nightly';
		} else {
			args.wp = config.wpVersion;
		}
	}

	if ( config.enableMultiWorker ) {
		const workerCount = Math.max( 1, cpus().length - 1 );
		logToConsole(
			`Enabling experimental multi-worker support with ${ workerCount } workers (CPU cores - 1)`
		);
		args.experimentalMultiWorker = workerCount;
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
			server = await runCLI( args );

			if ( config.enableMultiWorker && server ) {
				logToConsole( `Server started with ${ server.workerThreadCount } worker thread(s)` );
			}

			if ( config.adminPassword ) {
				await setAdminPassword( server, config.adminPassword );
			}
		} catch ( error ) {
			server = null;
			errorToConsole( `Failed to start server:`, error );
			throw error;
		}
	}
);

const STOP_SERVER_TIMEOUT = 5000;

async function stopServer(): Promise< void > {
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

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
