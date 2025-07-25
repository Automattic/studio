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
	try {
		// Parse command line arguments
		const configArg = process.argv[ 2 ];
		let runCLIPromise;

		if ( ! configArg ) {
			throw new Error( 'No configuration provided' );
		}

		const config: WorkerConfig = JSON.parse( configArg );

		if ( ! config.command || ! config.blueprint || ! config.hostPath ) {
			throw new Error( 'Missing required configuration fields' );
		}

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
			try {
				await server[ Symbol.asyncDispose ]();
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
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error( '[playground-cli-worker] Operation failed:', errorMessage );
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
