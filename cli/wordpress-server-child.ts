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
import { SupportedPHPVersion } from '@php-wasm/universal';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import { isWordPressDirectory } from 'common/lib/fs-utils';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { isWordPressDevVersion } from 'common/lib/wordpress-version-utils';
import { z } from 'zod';
import {
	ServerConfig,
	managerMessageSchema,
	ChildMessageRaw,
} from 'cli/lib/types/wordpress-server-ipc';

let server: RunCLIServer | null = null;

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
	console.log( new Date().toISOString(), `[WordPress Server Child]`, ...args );
}

function errorToConsole( ...args: Parameters< typeof console.error > ) {
	console.error( new Date().toISOString(), `[WordPress Server Child]`, ...args );
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

async function startServer( config: ServerConfig ): Promise< void > {
	if ( server ) {
		logToConsole( `Server already running for site ${ config.siteId }` );
		return;
	}

	try {
		const hasWordPress = isWordPressDirectory( config.sitePath );

		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
			isWpAutoUpdating: config.isWpAutoUpdating,
		} );

		const defaultConstants = {
			WP_SQLITE_AST_DRIVER: true,
		};

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
		];

		const args: RunCLIArgs = {
			command: 'server',
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
		const server = await runCLI( args );

		if ( ! server ) {
			throw new Error( 'Failed to start server: runCLI returned void' );
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

function sendErrorMessage( messageId: number, error: unknown ) {
	const errorResponse: ChildMessageRaw = {
		originalMessageId: messageId,
		topic: 'error',
		errorMessage: error instanceof Error ? error.message : String( error ),
		errorStack: error instanceof Error ? error.stack : undefined,
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

	let result: unknown;
	const validMessage = messageResult.data;

	switch ( validMessage.topic ) {
		case 'start-server':
			if ( validMessage.data.config ) {
				result = await startServer( validMessage.data.config );
			}
			break;
		default:
			throw new Error( `Unknown message topic: ${ validMessage.topic }` );
	}

	const response: ChildMessageRaw = {
		originalMessageId: validMessage.messageId,
		topic: 'result',
		result,
	};
	process.send!( response );
}

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
