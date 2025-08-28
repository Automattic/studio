import { net } from 'electron';
import nodePath from 'path';
import { SupportedPHPVersions } from '@php-wasm/universal';
import { Blueprint } from '@wp-playground/blueprints';
import { RecommendedPHPVersion } from '@wp-playground/common';
import fs from 'fs-extra';
import { recursiveCopyDirectory, pathExists } from 'src/lib/fs-utils';
import { installSqliteIntegration } from 'src/lib/sqlite-versions';
import { isValidWordPressVersion } from 'src/lib/wordpress-version-utils';
import { SiteServer } from 'src/site-server';
import { getResourcesPath, getServerFilesPath } from 'src/storage/paths';
import {
	WordPressProvider,
	WordPressServerInstance,
	WordPressServerOptions,
	WordPressServerProcess,
} from '../types';
import { PlaygroundServerProcess } from './playground-server-process';
import { PlaygroundInstanceManager } from './playground-instance-manager';

export interface PlaygroundCliOptions {
	port: number;
	phpVersion: string;
	documentRoot: string;
	autoMount: boolean;
	skipWordpressSetup: boolean;
	isSetupMode?: boolean;
	blueprint?: Blueprint;
}

export const PLAYGROUND_CLI_PROVIDER_NAME = 'playground-cli';

export class PlaygroundCliProvider implements WordPressProvider {
	readonly PROVIDER_TYPE = PLAYGROUND_CLI_PROVIDER_NAME;

	static readonly DEFAULT_PHP_VERSION = RecommendedPHPVersion;
	static readonly DEFAULT_WORDPRESS_VERSION = 'latest';
	static readonly ALLOWED_PHP_VERSIONS = [ ...SupportedPHPVersions ];
	static readonly SQLITE_FILENAME = 'sqlite-database-integration';
	static readonly SQLITE_FILENAME_LEGACY = 'sqlite-database-integration-main';

	// Instance constants for interface compatibility
	readonly DEFAULT_PHP_VERSION = PlaygroundCliProvider.DEFAULT_PHP_VERSION;
	readonly DEFAULT_WORDPRESS_VERSION = PlaygroundCliProvider.DEFAULT_WORDPRESS_VERSION;
	readonly ALLOWED_PHP_VERSIONS = PlaygroundCliProvider.ALLOWED_PHP_VERSIONS;
	readonly SQLITE_FILENAME = PlaygroundCliProvider.SQLITE_FILENAME;
	readonly SQLITE_FILENAME_LEGACY = PlaygroundCliProvider.SQLITE_FILENAME_LEGACY;

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
		wpCliPharPath?: string;
		blueprint?: Blueprint;
		siteId?: string; // Add siteId for instance tracking
	} ): Promise< WordPressServerInstance > {
		const port = options.port;
		const phpVersion = options.phpVersion || '8.3';

		// Check if we have an existing instance for this site
		// Only reuse if we're not in setup mode (i.e., for regular startServer calls)
		if ( options.siteId && ! options.isSetupMode ) {
			const instanceManager = PlaygroundInstanceManager.getInstance();
			const existing = instanceManager.get( options.siteId );
			
			if ( existing ) {
				console.log( `Transferring Playground server for site ${ options.siteId } to SiteServer management` );
				// Update the server options if needed
				existing.serverInstance.options = {
					...existing.serverInstance.options,
					absoluteUrl: options.absoluteUrl,
					adminPassword: options.adminPassword,
					siteTitle: options.siteTitle,
				};
				// Mark as reused so we know to skip port checks
				existing.serverInstance.isReused = true;
				// Remove from instance manager as SiteServer will manage it now
				// Note: We don't stop the process, just remove it from tracking
				instanceManager.untrack( options.siteId );
				return existing.serverInstance;
			}
		}

		const playgroundOptions: PlaygroundCliOptions = {
			port,
			phpVersion,
			documentRoot: options.path,
			autoMount: true,
			skipWordpressSetup: ! options.isSetupMode, // Only skip if not in setup mode
			isSetupMode: options.isSetupMode || false,
			blueprint: options.blueprint,
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

		return {
			url: `http://localhost:${ port }`,
			options: serverOptions,
			_internal: playgroundOptions,
			siteId: options.siteId, // Store siteId for tracking
		};
	}

	createServerProcess( serverInstance: WordPressServerInstance ): WordPressServerProcess {
		// Check if we already have a running process for this site
		if ( serverInstance.siteId ) {
			const instanceManager = PlaygroundInstanceManager.getInstance();
			const existing = instanceManager.get( serverInstance.siteId );
			
			if ( existing && existing.serverProcess ) {
				console.log( `Transferring existing Playground process for site ${ serverInstance.siteId } to SiteServer` );
				// Untrack from instance manager as SiteServer will manage it
				instanceManager.untrack( serverInstance.siteId );
				return existing.serverProcess;
			}
		}
		
		const playgroundOptions = serverInstance._internal as PlaygroundCliOptions;
		const process = new PlaygroundServerProcess(
			serverInstance.url,
			playgroundOptions,
			serverInstance.options
		);
		
		// Don't register in instance manager if this is a normal start
		// (only register during setupWordPressSite)
		
		return process;
	}

	getSqlitePath(): string {
		return nodePath.join( getServerFilesPath(), this.SQLITE_FILENAME );
	}

	getWpLoadPath( _serverProcess: WordPressServerProcess ): string {
		// Playground CLI mounts the WordPress directory at /wordpress in VFS
		return '/wordpress/wp-load.php';
	}

	async setupWordPressSite( server: SiteServer, wpVersion = 'latest' ): Promise< boolean > {
		const { path, port, adminPassword, name, phpVersion, id } = server.details;
		const { blueprint } = server.meta;

		try {
			const isOnline = net.isOnline();

			if ( ! isOnline ) {
				if ( wpVersion !== 'latest' ) {
					throw new Error(
						`Cannot set up WordPress version '${ wpVersion }' while offline. ` +
							'Specific WordPress versions require an internet connection to download. ' +
							'Try using "latest" version or ensure internet connectivity.'
					);
				}

				const bundledWPPath = nodePath.join(
					getResourcesPath(),
					'wp-files',
					'latest',
					'wordpress'
				);

				if ( ! ( await pathExists( bundledWPPath ) ) ) {
					throw new Error(
						'Cannot set up WordPress while offline. Bundled WordPress files not found. ' +
							'Please connect to the internet or reinstall WordPress Studio.'
					);
				}

				try {
					await recursiveCopyDirectory( bundledWPPath, path );
				} catch ( error ) {
					throw new Error(
						'Failed to copy WordPress files for offline setup. Please check directory permissions.'
					);
				}
			}

			// Ensure SQLite integration is installed before starting the server
			const wpConfigPath = path + '/wp-config.php';
			if ( ! ( await fs.pathExists( wpConfigPath ) ) ) {
				await installSqliteIntegration( path );
			}

			if ( ! isOnline ) {
				return true;
			}

			// Online mode: Start server in setup mode to install WP and run blueprint
			// The server will handle both setup and runtime in a single process
			const serverInstance = await this.startServer( {
				path,
				port,
				adminPassword: adminPassword || 'password',
				siteTitle: name,
				phpVersion: phpVersion || this.DEFAULT_PHP_VERSION,
				wpVersion,
				isWpAutoUpdating: false,
				isSetupMode: true, // Keep setup mode to ensure WP installation and blueprint execution
				blueprint: blueprint?.blueprint,
				siteId: id, // Pass site ID for instance tracking
			} );

			const serverProcess = this.createServerProcess( serverInstance );
			
			try {
				await serverProcess.start();
				
				// Register the running instance for reuse
				const instanceManager = PlaygroundInstanceManager.getInstance();
				instanceManager.register( id, serverInstance, serverProcess, true );
				
				console.log( `WordPress site setup complete and server running for site ${ id }` );
				return true;
			} catch ( error ) {
				// If setup fails, make sure to clean up
				try {
					await serverProcess.stop();
				} catch ( stopError ) {
					console.error( 'Failed to stop server after setup error:', stopError );
				}
				throw error;
			}
		} catch ( error ) {
			console.error( 'Failed to setup WordPress site:', error );
			throw error;
		}
	}

	isValidWordPressVersion( version: string ): boolean {
		return isValidWordPressVersion( version );
	}

	async getConfig( options: { path: string } ): Promise< { wpContentPath?: string } > {
		const wpContentPath = nodePath.join( options.path, 'wp-content' );

		if ( await pathExists( wpContentPath ) ) {
			return { wpContentPath };
		}

		return { wpContentPath: undefined };
	}

	/**
	 * Clean up managed instances for a specific site
	 */
	async cleanupInstance( siteId: string ): Promise< void > {
		const instanceManager = PlaygroundInstanceManager.getInstance();
		await instanceManager.remove( siteId );
	}

	/**
	 * Clean up all managed instances
	 */
	async cleanupAllInstances(): Promise< void > {
		const instanceManager = PlaygroundInstanceManager.getInstance();
		await instanceManager.cleanupAll();
	}
}
