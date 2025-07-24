import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SupportedPHPVersion, PHPRunOptions } from '@php-wasm/universal';
import { runCLI, RunCLIArgs, RunCLIServer } from '@wp-playground/cli';
import { WordPressServerOptions } from '../types';
import { createLoaderMuPlugin, getStandardMuPlugins } from './mu-plugins';
import { PlaygroundCliOptions } from './playground-cli-provider';

interface Message {
	id: number;
	type: string;
	data: {
		options: PlaygroundCliOptions;
		serverOptions: WordPressServerOptions;
		code: string;
	};
}

let server: RunCLIServer | null = null;

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
			default:
				throw new Error( `Unknown message type: ${ message.type }` );
		}

		process.parentPort.postMessage( { id: message.id, result } );
	} catch ( error ) {
		process.parentPort.postMessage( { id: message.id, error: ( error as Error ).message } );
	}
} );

process.parentPort.postMessage( { type: 'ready' } );

async function startServer(
	options: PlaygroundCliOptions,
	serverOptions: WordPressServerOptions
): Promise< void > {
	if ( server ) {
		throw new Error( 'Server is already running' );
	}

	try {
		// Create the mu-plugins directory and the loader mu-plugin to be mounted in the VFS
		const studioMuPluginsHostPath = await createMuPluginsDirectory( serverOptions );
		const loaderMuPluginHostPath = await createLoaderMuPlugin();

		// Build CLI command arguments
		const args: RunCLIArgs = {
			command: 'server',
			login: true,
			internalCookieStore: true,
			followSymlinks: true,
			skipWordPressSetup: true,
			// we will use Studio's SQLite management for now
			skipSqliteSetup: true,
			port: options.port,
			'mount-before-install': [
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
			],
		};

		// Add PHP version if specified
		if ( options.phpVersion ) {
			args.php = options.phpVersion as SupportedPHPVersion;
		}

		// Start the CLI server
		server = await runCLI( args );
	} catch ( error ) {
		server = null;
		throw new Error( `Could not start server: ${ error }` );
	}
}

async function stopServerFunc(): Promise< void > {
	if ( ! server ) {
		return;
	}

	try {
		await server[ Symbol.asyncDispose ]();
	} catch ( error ) {
		// Don't re-throw the error, just continue cleanup
	} finally {
		server = null;
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

async function createMuPluginsDirectory(
	serverOptions: WordPressServerOptions
): Promise< string > {
	try {
		// Create a temporary directory for mu-plugins
		const tempDir = await mkdtemp( join( tmpdir(), 'studio-mu-plugins-' ) );

		// Get the standard mu-plugins
		const muPlugins = getStandardMuPlugins( {
			isWpAutoUpdating: serverOptions.isWpAutoUpdating,
		} );

		// Write each mu-plugin file to the temporary directory
		for ( const plugin of muPlugins ) {
			const pluginPath = join( tempDir, plugin.filename );
			await writeFile( pluginPath, plugin.content );
		}
		return tempDir;
	} catch ( error ) {
		throw new Error( `Failed to create mu-plugins directory: ${ error }` );
	}
}
