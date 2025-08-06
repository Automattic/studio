import { net } from 'electron';
import nodePath from 'path';
import { SupportedPHPVersions } from '@php-wasm/universal';
import { RecommendedPHPVersion } from '@wp-playground/common';
import fs from 'fs-extra';
import { recursiveCopyDirectory, pathExists } from 'src/lib/fs-utils';
import { installSqliteIntegration } from 'src/lib/sqlite-versions';
import { isValidWordPressVersion } from 'src/lib/wordpress-version-utils';
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

	getSqlitePath(): string {
		return nodePath.join( getResourcesPath(), 'wp-files', this.SQLITE_FILENAME );
	}

	getWpLoadPath( _serverProcess: WordPressServerProcess ): string {
		// Playground CLI mounts the WordPress directory at /wordpress in VFS
		return '/wordpress/wp-load.php';
	}

	async setupWordPressSite( server: SiteServer, wpVersion = 'latest' ): Promise< boolean > {
		const { path, port, adminPassword, name, phpVersion } = server.details;

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

			// If we copied WordPress files offline, skip setup since files are already there
			const needsSetup = isOnline;
			const serverInstance = await this.startServer( {
				path,
				port,
				adminPassword: adminPassword || 'password',
				siteTitle: name,
				phpVersion: phpVersion || this.DEFAULT_PHP_VERSION,
				wpVersion,
				isWpAutoUpdating: false,
				isSetupMode: needsSetup,
			} );

			const serverProcess = this.createServerProcess( serverInstance );
			await serverProcess.start();
			return true;
		} catch ( error ) {
			console.error( 'Failed to setup WordPress site:', error );
			return false;
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
}
