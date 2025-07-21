import { SupportedPHPVersion } from '@php-wasm/universal';
import { runCLI, RunCLIArgs } from '@wp-playground/cli';
import { WordPressServerOptions } from '../types';
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

let serverUrl: string | null = null;
let stopServer: ( () => Promise< void > ) | null = null;

// Handle messages from parent process using parentPort
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
		console.error( '[playground-cli-child] Error handling message:', error );
		process.parentPort.postMessage( { id: message.id, error: ( error as Error ).message } );
	}
} );

// Send ready signal to parent
process.parentPort.postMessage( { type: 'ready' } );

async function startServer(
	options: PlaygroundCliOptions,
	_serverOptions: WordPressServerOptions
): Promise< void > {
	if ( stopServer ) {
		throw new Error( 'Server is already running' );
	}

	try {
		// Build CLI command arguments
		const args: RunCLIArgs = {
			command: 'server',
			skipWordPressSetup: true,
			port: options.port,
			mountBeforeInstall: [
				{
					hostPath: options.documentRoot,
					vfsPath: '/wordpress',
				},
			],
		};

		// Add PHP version if specified
		if ( options.phpVersion ) {
			args.php = options.phpVersion as SupportedPHPVersion;
		}

		console.log( '[playground-cli-child] Starting server with args:', args );

		// Start the CLI server
		const result = await runCLI( args );

		// Store the stop function
		stopServer = result.playground.stop;

		// The server is now running
		serverUrl = `http://127.0.0.1:${ options.port }`;
		console.log( '[playground-cli-child] Server started at:', serverUrl );
	} catch ( error ) {
		console.error( '[playground-cli-child] Error starting server:', error );
		stopServer = null;
		throw new Error( `Could not start server: ${ error }` );
	}
}

async function stopServerFunc(): Promise< void > {
	if ( ! stopServer ) {
		return;
	}

	try {
		console.log( '[playground-cli-child] Stopping server...' );

		// Call the stop function provided by runCLI
		await stopServer();

		stopServer = null;
		serverUrl = null;

		console.log( '[playground-cli-child] Server stopped' );
	} catch ( error ) {
		console.error( '[playground-cli-child] Error stopping server:', error );
		throw error;
	}
}

async function runPhp( _options: {
	code: string;
	scriptPath?: string;
	phpVersion?: string;
} ): Promise< string > {
	// For now, we'll throw an error as playground-cli doesn't directly support
	// running arbitrary PHP code like wp-now does
	throw new Error( 'runPhp is not yet implemented for playground-cli provider' );

	// TODO: In the future, this could be implemented by:
	// 1. Writing the PHP code to a temporary file in the document root
	// 2. Making an HTTP request to execute it
	// 3. Cleaning up the temporary file
}
