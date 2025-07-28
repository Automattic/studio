import path from 'path';
import fs from 'fs-extra';
import { installSqliteIntegration } from 'src/lib/sqlite-versions';
import { SiteServer } from 'src/site-server';
import { getResourcesPath } from 'src/storage/paths';
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
	isSetupMode?: boolean;
}

const SERVER_LIFETIME = 5 * 60 * 1000;

export const PLAYGROUND_CLI_PROVIDER_NAME = 'playground-cli';

export class PlaygroundCliProvider implements WordPressProvider {
	readonly PROVIDER_TYPE = PLAYGROUND_CLI_PROVIDER_NAME;

	// Minimal required constants
	readonly DEFAULT_PHP_VERSION = '8.3';
	readonly DEFAULT_WORDPRESS_VERSION = '6.6';
	readonly ALLOWED_PHP_VERSIONS = [ '7.4', '8.0', '8.1', '8.2', '8.3' ];
	readonly SQLITE_FILENAME = 'sqlite-database-integration';
	readonly SQLITE_FILENAME_LEGACY = 'sqlite-database-integration-main';

	// Setup server cache for site creation optimization
	private setupServers = new Map<
		string,
		{
			serverInstance: WordPressServerInstance;
			serverProcess: WordPressServerProcess;
			timeoutId?: NodeJS.Timeout;
		}
	>();

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
		isSetupMode?: boolean;
	} ): Promise< WordPressServerInstance > {
		const port = options.port;
		const phpVersion = options.phpVersion || '8.3';

		const playgroundOptions: PlaygroundCliOptions = {
			port,
			phpVersion,
			documentRoot: options.path,
			autoMount: true,
			skipWordpressSetup: true,
			isSetupMode: options.isSetupMode || false,
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

		// Check if we have a cached setup server for this document root
		const cachedSetup = this.setupServers.get( playgroundOptions.documentRoot );
		if ( cachedSetup ) {
			console.log(
				'[playground-cli] Using cached server process for',
				playgroundOptions.documentRoot
			);

			// Clear the timeout since we're now using this server
			if ( cachedSetup.timeoutId ) {
				clearTimeout( cachedSetup.timeoutId );
			}

			// Remove from cache since it's now being used as the main server
			this.setupServers.delete( playgroundOptions.documentRoot );

			// Return the already-running server process
			return cachedSetup.serverProcess;
		}

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
		return path.join( getResourcesPath(), 'wp-files', this.SQLITE_FILENAME );
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
		// This function is used during /src/setup-wp-server-files.ts
		return;
	}

	async setupWordPressSite( server: SiteServer, wpVersion = 'latest' ): Promise< boolean > {
		console.log(
			'[playground-cli] Setting up WordPress site by starting server with WordPress setup'
		);

		try {
			const { path, port, adminPassword, name, phpVersion } = server.details;
			console.log( `[playground-cli] Setting up WordPress version: ${ wpVersion }` );

			// Ensure SQLite integration is installed before starting the server
			const wpConfigPath = path + '/wp-config.php';
			if ( ! ( await fs.pathExists( wpConfigPath ) ) ) {
				console.log( '[playground-cli] Installing SQLite integration for new site' );
				await installSqliteIntegration( path );
			}

			// Create server instance with WordPress setup enabled
			const serverInstance = await this.startServer( {
				path,
				port,
				adminPassword: adminPassword || 'password',
				siteTitle: name,
				phpVersion: phpVersion || this.DEFAULT_PHP_VERSION,
				wpVersion,
				isWpAutoUpdating: false,
				isSetupMode: true,
			} );

			console.log(
				`[playground-cli] Server instance wordPressVersion: ${ serverInstance.options.wordPressVersion }`
			);

			const serverProcess = this.createServerProcess( serverInstance );
			console.log( '[playground-cli] Starting server for WordPress setup...' );
			await serverProcess.start();

			console.log(
				'[playground-cli] WordPress installation completed, keeping setup server running for optimization'
			);

			// Set up auto-cleanup timeout
			const timeoutId = setTimeout( () => {
				console.log( '[playground-cli] Auto-cleaning up unused setup server for', path );
				void this.cleanupSetupServer( path );
			}, SERVER_LIFETIME );

			this.setupServers.set( path, { serverInstance, serverProcess, timeoutId } );

			console.log( '[playground-cli] WordPress site setup completed successfully' );
			return true;
		} catch ( error ) {
			console.error( 'Failed to setup WordPress site:', error );
			this.setupServers.delete( server.details.path );
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
		options?: {
			phpVersion?: string;
			server?: WordPressServerProcess;
			serverDetails?: {
				port: number;
				adminPassword?: string;
				siteTitle: string;
				customDomain?: string;
			};
		}
	): Promise< {
		stdout: string;
		stderr: string;
		exitCode: number;
	} > {
		let server = options?.server;
		let tempServerProcess: WordPressServerProcess | null = null;

		// If no server is provided, check for cached setup server first
		if ( ! server ) {
			const cachedSetup = this.setupServers.get( projectPath );
			if ( cachedSetup ) {
				console.log( '[playground-cli] Using cached setup server for WP-CLI execution' );
				server = cachedSetup.serverProcess;
			} else {
				// Fall back to creating a temporary server
				if ( ! options?.serverDetails ) {
					throw new Error( 'Either server or serverDetails must be provided' );
				}

				const { port, adminPassword, siteTitle, customDomain } = options.serverDetails;
				const phpVersion = options.phpVersion || this.DEFAULT_PHP_VERSION;

				const tempServerInstance = await this.startServer( {
					path: projectPath,
					port,
					adminPassword: adminPassword || 'password',
					siteTitle,
					phpVersion,
					wpVersion: this.DEFAULT_WORDPRESS_VERSION,
					absoluteUrl: customDomain || `http://localhost:${ port }`,
					isSetupMode: false,
				} );

				tempServerProcess = this.createServerProcess( tempServerInstance );
				await tempServerProcess.start();
				server = tempServerProcess;
			}
		}

		console.log( '[playground-cli] Executing WP-CLI command:', args.join( ' ' ) );

		try {
			// Execute WP-CLI command using the phar file that playground CLI downloads
			const phpScript = `<?php
				// Build the arguments array
				$args = ${ JSON.stringify( args ) };

				// Change working directory to WordPress root
				chdir( '/wordpress' );

				// WP-CLI will define this constant itself, so we don't need to

				// Define CLI constants that WP-CLI expects
				if ( ! defined( 'STDOUT' ) ) {
					define( 'STDOUT', fopen( 'php://output', 'w' ) );
				}
				if ( ! defined( 'STDERR' ) ) {
					define( 'STDERR', fopen( 'php://stderr', 'w' ) );
				}
				if ( ! defined( 'STDIN' ) ) {
					define( 'STDIN', fopen( 'php://input', 'r' ) );
				}

				// Define WP-CLI namespaced constants
				if ( ! defined( 'WP_CLI\\Loggers\\STDERR' ) ) {
					define( 'WP_CLI\\Loggers\\STDERR', STDERR );
				}

				// Set up command line arguments for WP-CLI
				$_SERVER['argv'] = array_merge( [ 'wp' ], $args );
				$_SERVER['argc'] = count( $_SERVER['argv'] );

				global $argc, $argv;
				$argc = $_SERVER['argc'];
				$argv = $_SERVER['argv'];

				// Check if WP-CLI phar exists
				$wpCliPath = '/tmp/wp-cli.phar';
				if ( ! file_exists( $wpCliPath ) ) {
					echo "Error: WP-CLI phar not found at $wpCliPath";
					exit( 1 );
				}

				// Include WP-CLI phar directly using absolute path
				ob_start();
				include 'phar:///tmp/wp-cli.phar/php/boot-phar.php';
				$output = ob_get_contents();
				ob_end_clean();

				echo trim( $output );
			`;

			// Execute the PHP script using the running server
			const result = await server.runPhp( { code: phpScript } );

			// Clean the HTML warnings from WP-CLI output
			let cleanOutput = result;

			// Remove HTML warning tags about WP_CLI constant
			cleanOutput = cleanOutput.replace( /<br\s*\/?>\s*/gi, '\n' );
			cleanOutput = cleanOutput.replace(
				/<b>Warning<\/b>:\s*Constant WP_CLI already defined.*?<br\s*\/?>/gi,
				''
			);
			cleanOutput = cleanOutput.replace( /<b>.*?<\/b>/gi, '' );

			// Remove any leftover warning fragments
			cleanOutput = cleanOutput.replace( /:\s*Constant WP_CLI already defined.*?on line\s*/gi, '' );
			cleanOutput = cleanOutput.replace( /Warning:\s*Constant WP_CLI already defined.*?\n/gi, '' );

			// Remove extra whitespace and newlines
			cleanOutput = cleanOutput.replace( /^\s+|\s+$/g, '' );
			cleanOutput = cleanOutput.replace( /\n\s*\n/g, '\n' );

			console.log( 'wp-cli execute result ', result );
			console.log( 'cleanOutput', cleanOutput );

			return {
				stdout: cleanOutput,
				stderr: '',
				exitCode: 0,
			};
		} catch ( error ) {
			console.error( '[playground-cli] WP-CLI execution error:', error );
			return {
				stdout: '',
				stderr: error instanceof Error ? error.message : 'Unknown error occurred',
				exitCode: 1,
			};
		} finally {
			// Only stop temp servers, not cached setup servers
			if ( tempServerProcess ) {
				await tempServerProcess.stop();
			}
		}
	}

	async getConfig( _options: { path: string } ): Promise< { wpContentPath?: string } > {
		throw new Error( 'getConfig not implemented for playground-cli provider' );
	}

	// Cleanup methods for setup server management
	async cleanupSetupServer( path: string ): Promise< void > {
		const cachedSetup = this.setupServers.get( path );
		if ( cachedSetup ) {
			console.log( '[playground-cli] Cleaning up cached setup server for', path );

			// Clear the timeout if it exists
			if ( cachedSetup.timeoutId ) {
				clearTimeout( cachedSetup.timeoutId );
			}

			try {
				await cachedSetup.serverProcess.stop();
			} catch ( error ) {
				console.warn( '[playground-cli] Error stopping cached setup server:', error );
			}
			this.setupServers.delete( path );
		}
	}

	async cleanupAllSetupServers(): Promise< void > {
		console.log( '[playground-cli] Cleaning up all cached setup servers' );
		const cleanupPromises = Array.from( this.setupServers.keys() ).map( ( path ) =>
			this.cleanupSetupServer( path )
		);
		await Promise.allSettled( cleanupPromises );
	}

	// Get the count of active setup servers (for debugging/monitoring)
	getActiveSetupServerCount(): number {
		return this.setupServers.size;
	}

	// Check if there's a cached setup server for a given path
	hasCachedSetupServer( path: string ): boolean {
		return this.setupServers.has( path );
	}
}
