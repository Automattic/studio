import { SiteServer } from 'src/site-server';
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

	async setupWordPressSite( server: SiteServer, wpVersion = 'latest' ): Promise< boolean > {
		console.log(
			'[playground-cli] Setting up WordPress site by starting server with WordPress setup'
		);

		try {
			const { path, port, adminPassword, name, phpVersion } = server.details;
			console.log( `[playground-cli] Setting up WordPress version: ${ wpVersion }` );

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

			console.log( '[playground-cli] WordPress installation completed, stopping setup server...' );
			await serverProcess.stop();

			console.log( '[playground-cli] WordPress site setup completed successfully' );
			return true;
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

		// If no server is provided, run a temporary one
		if ( ! server ) {
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
			if ( tempServerProcess ) {
				await tempServerProcess.stop();
			}
		}
	}

	async getConfig( _options: { path: string } ): Promise< { wpContentPath?: string } > {
		throw new Error( 'getConfig not implemented for playground-cli provider' );
	}
}
