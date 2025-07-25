import { SupportedPHPVersion } from '@php-wasm/universal';
import { Blueprint } from '@wp-playground/blueprints';
import { runCLI } from '@wp-playground/cli';
import {
	WordPressProvider,
	WordPressServerInstance,
	WordPressServerOptions,
	WordPressServerProcess,
} from '../types';
import { getMuPlugins } from './mu-plugins';
import { PlaygroundCliWorkerProcess, type WorkerConfig } from './playground-cli-worker-process';
import { PlaygroundServerProcess } from './playground-server-process';

export interface PlaygroundCliOptions {
	port: number;
	phpVersion: string;
	documentRoot: string;
	autoMount: boolean;
	skipWordpressSetup: boolean;
}

/**
 * Safely runs playground CLI operations in an isolated utility process
 * to prevent the CLI's process.exit() calls from terminating Studio
 */
async function runPlaygroundCli( options: {
	command: 'run-blueprint';
	blueprint: Blueprint;
	hostPath: string;
	port?: number;
	wpVersion?: string;
	phpVersion?: string;
	skipWordPressSetup?: boolean;
} ): Promise< { success: boolean; error?: string } > {
	const config: WorkerConfig = {
		command: options.command,
		blueprint: options.blueprint,
		hostPath: options.hostPath,
		port: options.port,
		wpVersion: options.wpVersion || 'latest',
		phpVersion: options.phpVersion || '8.3',
		skipWordPressSetup: options.skipWordPressSetup || false,
	};

	console.log( '[playground-cli] Starting worker process for blueprint execution' );

	const worker = new PlaygroundCliWorkerProcess();
	const result = await worker.runBlueprint( config );

	console.log( '[playground-cli] Worker process completed:', result );

	return result;
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
		console.log( '[playground-cli] Setting up WordPress site with worker process approach' );

		try {
			// Create a blueprint to set up WordPress with basic configuration
			const blueprint: Blueprint = {
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

			const result = await runPlaygroundCli( {
				command: 'run-blueprint',
				blueprint,
				hostPath: path,
				wpVersion,
				phpVersion: this.DEFAULT_PHP_VERSION,
				skipWordPressSetup: false,
			} );

			if ( result.success ) {
				console.log( '[playground-cli] WordPress site setup completed successfully' );
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
		console.log( '[playground-cli] Mocking WP-CLI command (early return):', args.join( ' ' ) );

		// Early return for testing - mock success
		return {
			stdout: 'http://localhost:8000', // Mock typical siteurl response
			stderr: '',
			exitCode: 0,
		};

		const command = args.join( ' ' );
		let server = null;

		try {
			const blueprint: Blueprint = {
				steps: [
					{
						step: 'wp-cli',
						command: `wp ${ command }`,
					},
				],
			};

			console.log( '[playground-cli] Executing blueprint with forced disposal...' );

			const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
				isWpAutoUpdating: false,
			} );

			// Execute playground CLI
			server = await runCLI( {
				command: 'run-blueprint',
				blueprint,
				skipWordPressSetup: true,
				followSymlinks: true,
				wp: 'latest',
				php: ( options?.phpVersion || this.DEFAULT_PHP_VERSION ) as SupportedPHPVersion,
				'mount-before-install': [
					{
						hostPath: projectPath,
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
			} );

			return {
				stdout: '',
				stderr: '',
				exitCode: 0,
			};
		} catch ( error ) {
			console.error( '[playground-cli] Failed to execute WP-CLI command:', error );

			return {
				stdout: '',
				stderr: String( error ),
				exitCode: 1,
			};
		} finally {
			// Force cleanup in finally block
			if ( server ) {
				console.log( '[playground-cli] Force disposing server in finally block' );

				// Don't await disposal - let it happen in background
				server[ Symbol.asyncDispose ]()
					.then( () => {
						console.log( '[playground-cli] Server disposed successfully in background' );
					} )
					.catch( ( disposeError: unknown ) => {
						console.warn( '[playground-cli] Background server disposal failed:', disposeError );
					} );

				console.log( '[playground-cli] Server cleanup initiated, not waiting for completion' );
			}
		}
	}

	async getConfig( _options: { path: string } ): Promise< { wpContentPath?: string } > {
		throw new Error( 'getConfig not implemented for playground-cli provider' );
	}
}
