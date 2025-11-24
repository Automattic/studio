import { cpus } from 'os';
import { SupportedPHPVersion, PHPRunOptions } from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { sanitizeRunCLIArgs } from 'src/lib/sentry-sanitizer';
import { isWordPressDevVersion } from 'common/lib/wordpress-version-utils';
import { WordPressServerOptions } from '../types';
import { PlaygroundCliOptions } from './playground-cli-provider';

interface BaseMessage {
	id: number;
	type: string;
}

interface StartServerMessage extends BaseMessage {
	type: 'start-server';
	data: {
		options: PlaygroundCliOptions;
		serverOptions: WordPressServerOptions;
	};
}

interface StopServerMessage extends BaseMessage {
	type: 'stop-server';
	data: Record< string, never >;
}

interface RunPhpMessage extends BaseMessage {
	type: 'run-php';
	data: {
		code: string;
		scriptPath?: string;
		phpVersion?: string;
	};
}

interface HttpRequestMessage extends BaseMessage {
	type: 'http-request';
	data: {
		url: string;
		method: string;
		body: Record< string, string >;
	};
}

type Message = StartServerMessage | StopServerMessage | RunPhpMessage | HttpRequestMessage;

// Intercept and prefix all console output from playground-cli
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

/**
 * Messages come from the playground-cli, they can be found on the calls to `logger.log`
 * in the playground-cli source code, for example:
 * https://github.com/WordPress/wordpress-playground/blob/5ce5752af3cde8b65c745c527c54f3b4bc164a00/packages/playground/cli/src/run-cli.ts#L927
 *
 */
function formatMessageForUI( message: string ): string {
	if ( message.includes( 'WordPress is running' ) ) {
		return __( 'WordPress is running' );
	}
	if ( message.includes( 'Resolved WordPress release URL' ) ) {
		return __( 'Downloading WordPress…' );
	}
	if ( message.includes( 'Downloading WordPress' ) ) {
		return __( 'Downloading WordPress…' );
	}
	if ( message.includes( 'Starting up workers' ) ) {
		return __( 'Starting up workers…' );
	}
	if ( message.includes( 'Booting WordPress' ) ) {
		return __( 'Booting WordPress…' );
	}
	if ( message.includes( 'Running the Blueprint' ) ) {
		return __( 'Running the Blueprint…' );
	}
	if ( message.includes( 'Finished running the blueprint' ) ) {
		return __( 'Finished running the Blueprint…' );
	}
	if ( message.includes( 'Preparing workers' ) ) {
		return __( 'Preparing workers…' );
	}
	return message;
}

console.log = ( ...args: any[] ) => {
	originalConsoleLog( '[playground-cli]', ...args );
	const message = args.join( ' ' );
	process.parentPort.postMessage( { type: 'activity' } );
	const formattedMessage = formatMessageForUI( message );
	if ( formattedMessage ) {
		process.parentPort.postMessage( { type: 'console-message', message: formattedMessage } );
	}
};

console.error = ( ...args: any[] ) => {
	originalConsoleError( '[playground-cli]', ...args );
	process.parentPort.postMessage( { type: 'activity' } );
};

console.warn = ( ...args: any[] ) => {
	originalConsoleWarn( '[playground-cli]', ...args );
	process.parentPort.postMessage( { type: 'activity' } );
};

const originalStdoutWrite = process.stdout.write.bind( process.stdout );
const originalStderrWrite = process.stderr.write.bind( process.stderr );

process.stdout.write = function ( ...args: Parameters< typeof originalStdoutWrite > ) {
	process.parentPort.postMessage( { type: 'activity' } );
	return originalStdoutWrite( ...args );
} as typeof process.stdout.write;

process.stderr.write = function ( ...args: Parameters< typeof originalStderrWrite > ) {
	process.parentPort.postMessage( { type: 'activity' } );
	return originalStderrWrite( ...args );
} as typeof process.stderr.write;

let server: RunCLIServer | null | void = null;
let lastCliArgs: Record< string, unknown > | null = null;

process.parentPort.on( 'message', async ( event ) => {
	const message = event.data as Message;

	try {
		let result: unknown;

		switch ( message.type ) {
			case 'start-server':
				result = await startServer( message.data.options, message.data.serverOptions );
				break;
			case 'stop-server':
				result = await stopServerFunc();
				break;
			case 'run-php':
				result = await runPhp( message.data );
				break;
			case 'http-request':
				result = await httpRequest( message.data );
				break;
			default:
				throw new Error( `Unknown message type: ${ message }` );
		}

		process.parentPort.postMessage( { id: message.id, result } );
	} catch ( error ) {
		process.parentPort.postMessage( {
			id: message.id,
			error: error instanceof Error ? error.message : String( error ),
			errorStack: error instanceof Error ? error.stack : undefined,
			cliArgs: lastCliArgs,
		} );
	}
} );

process.parentPort.postMessage( { type: 'ready' } );

function escapePhpString( str: string ): string {
	return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

async function setAdminPassword( server: RunCLIServer, adminPassword: string ): Promise< void > {
	// Use the persistent mu-plugin API endpoint to avoid loading WordPress again
	await server.playground.request( {
		url: '/?studio-admin-api',
		method: 'POST',
		body: {
			action: 'set_admin_password',
			password: escapePhpString( adminPassword ),
		},
	} );
}

async function startServer(
	options: PlaygroundCliOptions,
	serverOptions: WordPressServerOptions
): Promise< void > {
	if ( server ) {
		return;
	}

	try {
		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( serverOptions );

		const defaultConstants = {
			WP_SQLITE_AST_DRIVER: true,
		};

		const mounts = [
			{
				hostPath: options.documentRoot,
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

		const args: RunCLIArgs & { command: 'server' } = {
			command: 'server',
			internalCookieStore: false,
			login: false,
			followSymlinks: true,
			skipSqliteSetup: true,
			port: options.port,
			'mount-before-install': mounts,
			'site-url': serverOptions.absoluteUrl,
			blueprint: options.blueprint || {},
			wordpressInstallMode: options.wordpressInstallMode,
		};

		// Enable multi-worker support if beta feature is enabled
		if ( options.enableMultiWorker ) {
			const workerCount = Math.max( 1, cpus().length - 1 );
			console.log(
				`[playground-cli] Enabling experimental multi-worker support with ${ workerCount } workers (CPU cores - 1)`
			);
			args.experimentalMultiWorker = workerCount;
		}

		if ( options.phpVersion ) {
			args.php = options.phpVersion as SupportedPHPVersion;
		}

		if ( serverOptions.wordPressVersion ) {
			if ( isWordPressDevVersion( serverOptions.wordPressVersion ) ) {
				args.wp = 'nightly';
			} else {
				args.wp = serverOptions.wordPressVersion;
			}
		}

		args.blueprint.constants = { ...args.blueprint.constants, ...defaultConstants };

		lastCliArgs = sanitizeRunCLIArgs( args );

		server = await runCLI( args );

		// Log actual worker count for verification
		if ( options.enableMultiWorker ) {
			console.log(
				`[playground-cli] Server started with ${ server.workerThreadCount } worker thread(s)`
			);
		}

		if ( serverOptions.adminPassword ) {
			await setAdminPassword( server, serverOptions.adminPassword );
		}
	} catch ( error ) {
		server = null;
		// Re-throw the original error to preserve stack trace
		if ( error instanceof Error ) {
			error.message = `Could not start server: ${ error.message }`;
			throw error;
		}
		throw new Error( `Could not start server: ${ error }` );
	}
}

async function stopServerFunc(): Promise< void > {
	if ( ! server ) {
		return;
	}

	const serverToDispose = server;
	server = null;

	try {
		const disposalTimeout = new Promise( ( _, reject ) =>
			setTimeout( () => reject( new Error( 'Disposal timeout' ) ), 5000 )
		);

		await Promise.race( [ serverToDispose[ Symbol.asyncDispose ](), disposalTimeout ] );
	} catch ( error ) {
		// Suppress expected disposal errors that occur during site deletion
		// These are typically race conditions that don't affect functionality
		const errorMessage = error instanceof Error ? error.message : String( error );
		if ( ! errorMessage.includes( 'Cannot read properties of undefined' ) ) {
			console.warn( 'Error during server disposal:', error );
		}
	} finally {
		server = null;
	}
}

async function httpRequest( options: {
	url: string;
	method: string;
	body: Record< string, string >;
} ): Promise< { text: string } > {
	if ( ! server ) {
		throw new Error( 'Server is not initialized. Make sure the server is started.' );
	}

	try {
		const response = await server.playground.request( {
			url: options.url,
			method: options.method as 'GET' | 'POST',
			body: options.body,
		} );

		return { text: response.text };
	} catch ( error ) {
		throw new Error( `Failed to make HTTP request: ${ error }` );
	}
}

async function runPhp( options: {
	code: string;
	scriptPath?: string;
	phpVersion?: string;
} ): Promise< string > {
	if ( ! server ) {
		throw new Error( 'Server is not initialized. Make sure the server is started.' );
	}

	try {
		// Replace host filesystem paths with VFS paths
		// The document root is mounted at /wordpress in the VFS
		let modifiedCode = options.code;

		modifiedCode = modifiedCode.replace(
			/((?:require_once|require|include_once|include)\s*\(\s*['"])([^'"]+)(['"]\s*\))/g,
			( match, prefix, path, suffix ) => {
				// Don't modify phar:// paths
				if ( path.startsWith( 'phar://' ) ) {
					return match;
				}

				if ( path.startsWith( '/' ) && ! path.startsWith( '/wordpress' ) ) {
					const wpMatch = path.match( /(\/(?:wp-[^/]+\.php|wp-content|wp-includes|wp-admin).*)$/ );
					if ( wpMatch ) {
						return `${ prefix }/wordpress${ wpMatch[ 1 ] }${ suffix }`;
					}
					const fileMatch = path.match( /\/([^/]+\.php)$/ );
					if ( fileMatch ) {
						return `${ prefix }/wordpress/${ fileMatch[ 1 ] }${ suffix }`;
					}
				}
				return match;
			}
		);

		// Also handle direct file references and string concatenations
		modifiedCode = modifiedCode.replace(
			/(['"])([^'"]*\/(?:wp-[^/]*|[^/]+\.php|wp-content|wp-includes|wp-admin)[^'"]*)(['"])/g,
			( match, quote1, path, quote2 ) => {
				// Don't modify phar:// paths
				if ( path.startsWith( 'phar://' ) ) {
					return match;
				}

				if ( path.startsWith( '/wordpress' ) || ! path.startsWith( '/' ) ) {
					return match;
				}
				const wpMatch = path.match( /(\/(?:wp-[^/]+\.php|wp-content|wp-includes|wp-admin).*)$/ );
				if ( wpMatch ) {
					return `${ quote1 }/wordpress${ wpMatch[ 1 ] }${ quote2 }`;
				}
				const fileMatch = path.match( /\/([^/]+\.php)$/ );
				if ( fileMatch ) {
					return `${ quote1 }/wordpress/${ fileMatch[ 1 ] }${ quote2 }`;
				}
				return match;
			}
		);

		const runOptions: PHPRunOptions = {
			code: modifiedCode,
		};

		if ( options.scriptPath ) {
			runOptions.scriptPath = options.scriptPath;
		}

		const response = await server.playground.run( runOptions );

		return response.text || '';
	} catch ( error ) {
		throw new Error( `Failed to run PHP code: ${ error }` );
	}
}
