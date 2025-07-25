import { SupportedPHPVersion } from '@php-wasm/universal';
import { runCLI } from '@wp-playground/cli';
import type { Blueprint } from '@wp-playground/blueprints';

/**
 * Isolated utility process worker for running playground CLI operations
 * This prevents the CLI's process.exit() calls from terminating Studio
 * Uses Electron's utilityProcess.fork() for better integration
 */
interface WorkerMessage {
	id: number;
	type: string;
	data: {
		command: 'run-blueprint';
		blueprint: Blueprint;
		hostPath: string;
		port?: number;
		wpVersion?: string;
		phpVersion?: string;
		skipWordPressSetup?: boolean;
	};
}

// Handle messages from the parent process
process.parentPort.on( 'message', async ( event ) => {
	const message = event.data as WorkerMessage;
	try {
		let result: unknown;

		switch ( message.type ) {
			case 'run-blueprint':
				result = await runBlueprint( message.data );
				break;
			default:
				throw new Error( `Unknown message type: ${ message.type }` );
		}

		process.parentPort.postMessage( { id: message.id, result } );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error( '[playground-cli-worker] Operation failed:', errorMessage );
		process.parentPort.postMessage( { id: message.id, error: errorMessage } );
	}
} );

async function runBlueprint( config: WorkerMessage[ 'data' ] ): Promise< { success: boolean } > {
	console.log( '[playground-cli-worker] Starting blueprint execution' );

	if ( ! config.command || ! config.blueprint || ! config.hostPath ) {
		throw new Error( 'Missing required configuration fields' );
	}

	try {
		// Use run-blueprint for one-time setup only - let CLI handle its own lifecycle
		const cliOptions = {
			command: config.command, // Should be 'run-blueprint'
			blueprint: config.blueprint,
			skipWordPressSetup: config.skipWordPressSetup || false,
			followSymlinks: true,
			wp: config.wpVersion || 'latest',
			php: ( config.phpVersion as SupportedPHPVersion ) || '8.3',
			port: config.port,
			'mount-before-install': [
				{
					hostPath: config.hostPath,
					vfsPath: '/wordpress',
				},
			],
		};

		console.log(
			'[playground-cli-worker] CLI options being sent:',
			JSON.stringify( cliOptions, null, 2 )
		);

		console.log( '[playground-cli-worker] Running blueprint...' );

		// Execute the CLI and get the server instance
		const server = await runCLI( cliOptions );

		console.log( '[playground-cli-worker] Blueprint execution completed, disposing server...' );

		// Dispose of the server properly like the playground child process does
		try {
			await server[ Symbol.asyncDispose ]();
			console.log( '[playground-cli-worker] Server disposed successfully' );
		} catch ( disposeError ) {
			console.error( '[playground-cli-worker] Server disposal failed:', disposeError );
			// Don't throw - still consider the blueprint execution successful
		}

		return { success: true };
	} catch ( runCLIError ) {
		console.error( '[playground-cli-worker] runCLI threw an error:', runCLIError );
		throw runCLIError;
	}
}

// Send ready signal to parent process
process.parentPort.postMessage( { type: 'ready' } );

// Handle unhandled rejections to prevent silent failures
process.on( 'unhandledRejection', ( reason ) => {
	console.error( '[playground-cli-worker] Unhandled rejection:', reason );
	process.exit( 1 );
} );

process.on( 'uncaughtException', ( error ) => {
	console.error( '[playground-cli-worker] Uncaught exception:', error );
	process.exit( 1 );
} );
