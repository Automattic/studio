import { spawn } from 'child_process';
import { Blueprint } from '@wp-playground/blueprints';
import {
	WordPressProvider,
	WordPressServerInstance,
	WordPressServerOptions,
	WordPressServerProcess,
} from '../types';
import { PlaygroundServerProcess } from './playground-server-process';

export interface PlaygroundCliOptions {
	port: number;
	phpVersion: string;
	documentRoot: string;
	autoMount: boolean;
	skipWordpressSetup: boolean;
}

declare const PLAYGROUND_CLI_WORKER_MODULE_PATH: string;

/**
 * Safely runs playground CLI operations in an isolated child process
 * to prevent the CLI's process.exit() calls from terminating Studio
 */
async function runPlaygroundCliSafely( options: {
	command: 'run-blueprint';
	blueprint: Blueprint;
	hostPath: string;
	wpVersion?: string;
	phpVersion?: string;
	skipWordPressSetup?: boolean;
} ): Promise< { success: boolean; error?: string } > {
	// Path to the webpack-compiled worker script
	const workerScriptPath = PLAYGROUND_CLI_WORKER_MODULE_PATH;

	// Configuration to pass to the worker
	const config = {
		command: options.command,
		blueprint: options.blueprint,
		hostPath: options.hostPath,
		wpVersion: options.wpVersion || 'latest',
		phpVersion: options.phpVersion || '8.3',
		skipWordPressSetup: options.skipWordPressSetup || false,
	};

	try {
		// Run the dedicated worker script in isolated child process
		return new Promise( ( resolve ) => {
			const child = spawn( 'node', [ workerScriptPath, JSON.stringify( config ) ], {
				stdio: 'pipe',
				detached: false,
				timeout: 120000, // 2 minute timeout
			} );

			let output = '';
			let errorOutput = '';

			child.stdout?.on( 'data', ( data ) => {
				output += data.toString();
			} );

			child.stderr?.on( 'data', ( data ) => {
				errorOutput += data.toString();
			} );

			child.on( 'close', ( code ) => {
				// Check for success indicators: either explicit SUCCESS marker or Blueprint executed + exit code 0
				const hasSuccessMarker = output.includes( 'SUCCESS' );
				const hasBlueprintExecuted = output.includes( 'Blueprint executed' );
				const isSuccessful = code === 0 && ( hasSuccessMarker || hasBlueprintExecuted );

				// Log failures for debugging
				if ( ! isSuccessful ) {
					console.log( `[playground-cli] Process failed with code: ${ code }` );
					if ( errorOutput ) {
						console.log( `[playground-cli] Error output:`, errorOutput );
					}
				}

				if ( isSuccessful ) {
					resolve( { success: true } );
				} else {
					// Extract error message from output if available
					const errorMatch = errorOutput.match( /ERROR: (.+)/ );
					const errorMessage = errorMatch
						? errorMatch[ 1 ]
						: errorOutput || `Process exited with code ${ code }`;

					resolve( {
						success: false,
						error: errorMessage,
					} );
				}
			} );

			child.on( 'error', ( error ) => {
				resolve( {
					success: false,
					error: error.message,
				} );
			} );
		} );
	} catch ( error ) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

export const PLAYGROUND_CLI_PROVIDER_NAME = 'playground-cli';

export class PlaygroundCliProvider implements WordPressProvider {
	readonly PROVIDER_TYPE = PLAYGROUND_CLI_PROVIDER_NAME;

	// Minimal required constants
	readonly DEFAULT_PHP_VERSION = '8.3';
	readonly DEFAULT_WORDPRESS_VERSION = '6.6';
	readonly ALLOWED_PHP_VERSIONS = [ '7.4', '8.0', '8.1', '8.2', '8.3' ];
	readonly SQLITE_FILENAME = 'database.sqlite';
	readonly SQLITE_FILENAME_LEGACY = 'db.sqlite';

	// Start/Stop functionality only
	async startServer( options: {
		path: string;
		port: number;
		adminPassword: string;
		siteTitle: string;
		phpVersion?: string;
		wpVersion?: string;
		isWpAutoUpdating?: boolean;
		absoluteUrl?: string;
		siteLanguage?: string;
	} ): Promise< WordPressServerInstance > {

		const port = options.port;
		const phpVersion = options.phpVersion || '8.3';

		const playgroundOptions: PlaygroundCliOptions = {
			port,
			phpVersion,
			documentRoot: options.path,
			autoMount: true,
			skipWordpressSetup: true,
		};

		const serverOptions: WordPressServerOptions = {
			documentRoot: options.path,
			phpVersion,
			port,
			absoluteUrl: options.absoluteUrl,
			projectPath: options.path,
			adminPassword: options.adminPassword,
			siteTitle: options.siteTitle,
			siteLanguage: options.siteLanguage,
			wordPressVersion: options.wpVersion,
			isWpAutoUpdating: options.isWpAutoUpdating,
		};

		const url = `http://127.0.0.1:${ port }`;

		return {
			url,
			options: serverOptions,
			_internal: playgroundOptions,
		};
	}

	createServerProcess( serverInstance: WordPressServerInstance ): WordPressServerProcess {

		const playgroundOptions = serverInstance._internal as PlaygroundCliOptions;
		return new PlaygroundServerProcess(
			serverInstance.url,
			playgroundOptions,
			serverInstance.options
		);
	}

	// Unsupported methods - throw errors to indicate they need different implementation
	getWordPressVersionPath( _version: string ): string {
		throw new Error( 'getWordPressVersionPath not implemented for playground-cli provider' );
	}

	getSqlitePath(): string {
		throw new Error( 'getSqlitePath not implemented for playground-cli provider' );
	}

	getWpCliPath(): string {
		throw new Error( 'getWpCliPath not implemented for playground-cli provider' );
	}

	getWpCliFolderPath(): string {
		throw new Error( 'getWpCliFolderPath not implemented for playground-cli provider' );
	}

	async downloadWordPress( _version?: string, _options?: { overwrite: boolean } ): Promise< void > {
		throw new Error( 'downloadWordPress not implemented for playground-cli provider' );
	}

	async downloadWpCli(
		_overwrite?: boolean
	): Promise< { downloaded: boolean; statusCode: number } > {
		throw new Error( 'downloadWpCli not implemented for playground-cli provider' );
	}

	async downloadSQLiteCommand( _downloadUrl: string, _targetPath: string ): Promise< void > {
		throw new Error( 'downloadSQLiteCommand not implemented for playground-cli provider' );
	}

	async setupWordPressSite( path: string, wpVersion = 'latest' ): Promise< boolean > {

		try {
			// Create a blueprint to set up WordPress with basic configuration
			const blueprint: Blueprint = {
				landingPage: '/wp-admin/',
				steps: [
					{
						step: 'setSiteOptions',
						options: {
							blogname: 'My WordPress Site',
						},
					},
					{
						step: 'wp-cli',
						command: 'wp user update admin --user_pass="password"',
					},
				],
			};

			// Use isolated child process to prevent CLI from crashing Studio
			const result = await runPlaygroundCliSafely( {
				command: 'run-blueprint',
				blueprint,
				hostPath: path,
				wpVersion,
				phpVersion: this.DEFAULT_PHP_VERSION,
				skipWordPressSetup: false,
			} );

			if ( result.success ) {
				return true;
			} else {
				console.error( '[playground-cli] WordPress site setup failed:', result.error );
				return false;
			}
		} catch ( error ) {
			console.error( 'Failed to setup WordPress site:', error );
			return false;
		}
	}

	async isWordPressVersionInstalled( _version: string ): Promise< boolean > {
		throw new Error( 'isWordPressVersionInstalled not implemented for playground-cli provider' );
	}

	isValidWordPressVersion( _version: string ): boolean {
		throw new Error( 'isValidWordPressVersion not implemented for playground-cli provider' );
	}

	async executeWPCli(
		projectPath: string,
		args: string[],
		options?: { phpVersion?: string }
	): Promise< {
		stdout: string;
		stderr: string;
		exitCode: number;
	} > {
		try {
			const command = args.join( ' ' );

			// Create a blueprint to run the WP-CLI command
			const blueprint: Blueprint = {
				steps: [
					{
						step: 'wp-cli',
						command: `wp ${ command }`, // Add "wp" prefix to the command
					},
				],
			};

			// Use isolated child process to prevent CLI from crashing Studio
			const result = await runPlaygroundCliSafely( {
				command: 'run-blueprint',
				blueprint,
				hostPath: projectPath,
				phpVersion: options?.phpVersion || this.DEFAULT_PHP_VERSION,
				skipWordPressSetup: true, // Assume WordPress is already set up
			} );

			if ( result.success ) {
				// For successful commands, we can't get the actual output from the blueprint
				// since it's executed in an isolated environment. Return a generic success message.
				return {
					stdout: '', // Empty stdout since we can't capture the actual output
					stderr: '',
					exitCode: 0,
				};
			} else {
				return {
					stdout: '',
					stderr: result.error || 'Unknown error',
					exitCode: 1,
				};
			}
		} catch ( error ) {
			console.error( 'Failed to execute WP-CLI command:', error );
			return {
				stdout: '',
				stderr: error instanceof Error ? error.message : 'Unknown error',
				exitCode: 1,
			};
		}
	}

	async getConfig( _options: { path: string } ): Promise< { wpContentPath?: string } > {
		throw new Error( 'getConfig not implemented for playground-cli provider' );
	}
}
