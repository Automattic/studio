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
import { SupportedPHPVersion } from '@php-wasm/universal';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import { sanitizeRunCLIArgs } from 'common/lib/cli-args-sanitizer';
import { isWordPressDirectory } from 'common/lib/fs-utils';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { formatPlaygroundCliMessage } from 'common/lib/playground-cli-messages';
import { isWordPressDevVersion } from 'common/lib/wordpress-version-utils';
import { z } from 'zod';
import { getWpCliPharPath } from 'cli/lib/server-files';
import {
	ServerConfig,
	managerMessageSchema,
	ChildMessageRaw,
} from 'cli/lib/types/wordpress-server-ipc';

let server: RunCLIServer | null = null;
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
			password: escapePhpString( adminPassword ),
		},
	} );
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
	const hasWordPress = isWordPressDirectory( config.sitePath );

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
	];

	const defaultConstants = {
		WP_SQLITE_AST_DRIVER: true,
	};

	const args: RunCLIArgs = {
		command,
		internalCookieStore: false,
		login: false,
		followSymlinks: true,
		skipSqliteSetup: true,
		port: config.port,
		'mount-before-install': mounts,
		'site-url': config.absoluteUrl || `http://localhost:${ config.port }`,
		blueprint: config.blueprint || {},
		wordpressInstallMode: 'download-and-install',
	};

	if ( hasWordPress ) {
		args.wordpressInstallMode = 'install-from-existing-files-if-needed';
	}

	if ( config.phpVersion ) {
		args.php = config.phpVersion as SupportedPHPVersion;
	}

	if ( config.wpVersion ) {
		if ( isWordPressDevVersion( config.wpVersion ) ) {
			args.wp = 'nightly';
		} else {
			args.wp = config.wpVersion;
		}
	}

	args.blueprint.constants = { ...args.blueprint.constants, ...defaultConstants };

	if ( config.enableMultiWorker ) {
		const workerCount = Math.max( 1, cpus().length - 1 );
		logToConsole(
			`Enabling experimental multi-worker support with ${ workerCount } workers (CPU cores - 1)`
		);
		args.experimentalMultiWorker = workerCount;
	}

	return args;
}

async function startServer( config: ServerConfig ): Promise< void > {
	if ( server ) {
		logToConsole( `Server already running for site ${ config.siteId }` );
		return;
	}

	try {
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

async function runBlueprint( config: ServerConfig ): Promise< void > {
	try {
		const args = await getBaseRunCLIArgs( 'run-blueprint', config );
		lastCliArgs = sanitizeRunCLIArgs( args );
		await runCLI( args );

		logToConsole( `Blueprint applied successfully for site ${ config.siteId }` );
	} catch ( error ) {
		errorToConsole( `Failed to run blueprint:`, error );
		throw error;
	}
}

async function runWpCliCommand(
	args: string[]
): Promise< { stdout: string; stderr: string; exitCode: number } > {
	if ( ! server ) {
		throw new Error( `Failed to run WP CLI command because server is not running` );
	}

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
}

function sendErrorMessage( messageId: number, error: unknown ) {
	const errorResponse: ChildMessageRaw = {
		originalMessageId: messageId,
		topic: 'error',
		errorMessage: error instanceof Error ? error.message : String( error ),
		errorStack: error instanceof Error ? error.stack : undefined,
		cliArgs: lastCliArgs ?? undefined,
	};
	process.send!( errorResponse );
}

async function ipcMessageHandler( packet: unknown ) {
	const messageResult = managerMessageSchema.safeParse( packet );

	if ( ! messageResult.success ) {
		errorToConsole( 'Invalid message received:', messageResult.error );

		const minimalMessageSchema = z.object( { id: z.number() } );
		const minimalMessage = minimalMessageSchema.safeParse( packet );
		if ( minimalMessage.success ) {
			sendErrorMessage( minimalMessage.data.id, messageResult.error );
		}
		return;
	}

	const validMessage = messageResult.data;

	try {
		let result: unknown;

		switch ( validMessage.topic ) {
			case 'start-server':
				result = await startServer( validMessage.data.config );
				break;
			case 'run-blueprint':
				result = await runBlueprint( validMessage.data.config );
				break;
			case 'stop-server':
				result = await stopServer();
				break;
			case 'wp-cli-command':
				result = await runWpCliCommand( validMessage.data.args );
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
	}
}

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
