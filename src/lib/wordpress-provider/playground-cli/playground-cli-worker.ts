import { SupportedPHPVersion } from '@php-wasm/universal';
import { runCLI } from '@wp-playground/cli';
import type { Blueprint } from '@wp-playground/blueprints';

/**
 * Isolated worker script for running playground CLI operations
 * This prevents the CLI's process.exit() calls from terminating Studio
 */

interface WorkerConfig {
	command: 'run-blueprint';
	blueprint: Blueprint;
	hostPath: string;
	wpVersion?: string;
	phpVersion?: string;
	skipWordPressSetup?: boolean;
}

async function main(): Promise< void > {
	console.log( '[playground-cli-worker] Worker process started' );
	console.log( '[playground-cli-worker] Process arguments:', process.argv );

	try {
		// Parse command line arguments
		const configArg = process.argv[ 2 ];
		console.log( '[playground-cli-worker] Config argument:', configArg );

		if ( ! configArg ) {
			throw new Error( 'No configuration provided' );
		}

		const config: WorkerConfig = JSON.parse( configArg );
		console.log( '[playground-cli-worker] Parsed config:', config );

		// Validate required fields
		if ( ! config.command || ! config.blueprint || ! config.hostPath ) {
			throw new Error( 'Missing required configuration fields' );
		}

		console.log( `[playground-cli-worker] Starting ${ config.command } operation` );
		console.log( `[playground-cli-worker] Host path: ${ config.hostPath }` );
		console.log( `[playground-cli-worker] PHP version: ${ config.phpVersion || '8.3' }` );
		console.log( `[playground-cli-worker] WordPress version: ${ config.wpVersion || 'latest' }` );

		// Run the CLI operation
		console.log( '[playground-cli-worker] About to call runCLI' );

		// Set up a success indicator before calling runCLI
		// Since runCLI might call process.exit, we need to print SUCCESS as early as possible
		let runCLIPromise;

		try {
			runCLIPromise = runCLI( {
				command: config.command,
				blueprint: config.blueprint,
				skipWordPressSetup: config.skipWordPressSetup || false,
				followSymlinks: true,
				wp: config.wpVersion || 'latest',
				php: ( config.phpVersion as SupportedPHPVersion ) || '8.3',
				'mount-before-install': [
					{
						hostPath: config.hostPath,
						vfsPath: '/wordpress',
					},
				],
			} );

			const server = await runCLIPromise;

			// If we get here, runCLI completed without calling process.exit
			console.log( '[playground-cli-worker] runCLI completed successfully' );
			console.log( 'SUCCESS' );

			// Clean up the server
			try {
				await server[ Symbol.asyncDispose ]();
				console.log( '[playground-cli-worker] Server disposed successfully' );
			} catch ( disposeError ) {
				console.log(
					'[playground-cli-worker] Server disposal failed, but operation was successful:',
					disposeError
				);
			}
		} catch ( runCLIError ) {
			// This should not happen if runCLI works correctly, but just in case
			console.error( '[playground-cli-worker] runCLI threw an error:', runCLIError );
			throw runCLIError;
		}

		console.log( '[playground-cli-worker] Operation completed successfully' );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error( '[playground-cli-worker] Operation failed:', errorMessage );
		console.error( 'ERROR:', errorMessage ); // Error marker for parent process
		process.exit( 1 );
	}
}

// Handle unhandled rejections to prevent silent failures
process.on( 'unhandledRejection', ( reason ) => {
	console.error( '[playground-cli-worker] Unhandled rejection:', reason );
	process.exit( 1 );
} );

process.on( 'uncaughtException', ( error ) => {
	console.error( '[playground-cli-worker] Uncaught exception:', error );
	process.exit( 1 );
} );

void main();
