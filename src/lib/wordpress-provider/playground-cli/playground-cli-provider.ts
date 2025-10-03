import { net } from 'electron';
import nodePath from 'path';
import { SupportedPHPVersions } from '@php-wasm/universal';
import { Blueprint } from '@wp-playground/blueprints';
import { RecommendedPHPVersion } from '@wp-playground/common';
import { recursiveCopyDirectory, pathExists } from 'common/lib/fs-utils';
import { DEFAULT_LOCALE } from 'common/lib/locale';
import { getPreferredSiteLanguage } from 'src/lib/site-language';
import { keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
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
	static readonly MINIMUM_WORDPRESS_VERSION = '6.2.1'; // https://wordpress.github.io/wordpress-playground/blueprints/examples/#load-an-older-wordpress-version
	static readonly SQLITE_FILENAME = 'sqlite-database-integration';
	static readonly SQLITE_FILENAME_LEGACY = 'sqlite-database-integration-main';

	// Instance constants for interface compatibility
	readonly DEFAULT_PHP_VERSION = PlaygroundCliProvider.DEFAULT_PHP_VERSION;
	readonly DEFAULT_WORDPRESS_VERSION = PlaygroundCliProvider.DEFAULT_WORDPRESS_VERSION;
	readonly ALLOWED_PHP_VERSIONS = PlaygroundCliProvider.ALLOWED_PHP_VERSIONS;
	readonly MINIMUM_WORDPRESS_VERSION = PlaygroundCliProvider.MINIMUM_WORDPRESS_VERSION;
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
			isSetupMode: options.isSetupMode,
		};

		return {
			url: `http://localhost:${ port }`,
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
		return nodePath.join( getServerFilesPath(), this.SQLITE_FILENAME );
	}

	getWpLoadPath( _serverProcess: WordPressServerProcess ): string {
		// Playground CLI mounts the WordPress directory at /wordpress in VFS
		return '/wordpress/wp-load.php';
	}

	async setupWordPressSite( server: SiteServer, wpVersion = 'latest' ): Promise< boolean > {
		const setupStartTime = Date.now();
		console.log( '[PERF] setupWordPressSite: Starting setup' );

		const { path, port, adminPassword, name, phpVersion } = server.details;
		const { blueprint } = server.meta;

		const languageStart = Date.now();
		const siteLanguage = await getPreferredSiteLanguage( wpVersion );
		console.log( `[PERF] setupWordPressSite: getPreferredSiteLanguage took ${ Date.now() - languageStart }ms` );

		const serverOptions = {
			path,
			port,
			adminPassword: adminPassword || 'password',
			siteTitle: name,
			phpVersion: phpVersion || this.DEFAULT_PHP_VERSION,
			wpVersion,
			isWpAutoUpdating: false,
			isSetupMode: true,
			blueprint: blueprint?.blueprint,
			siteLanguage,
		};
		let serverProcess;

		try {
			const isOnlineCheckStart = Date.now();
			const isOnline = net.isOnline();
			console.log( `[PERF] setupWordPressSite: Online check took ${ Date.now() - isOnlineCheckStart }ms` );

			if ( ! isOnline ) {
				console.log( '[PERF] setupWordPressSite: Offline mode detected' );
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
					const copyStartTime = Date.now();
					await recursiveCopyDirectory( bundledWPPath, path );
					console.log( `[PERF] setupWordPressSite: Copy WordPress files took ${ Date.now() - copyStartTime }ms` );
					serverOptions.wpVersion = this.DEFAULT_WORDPRESS_VERSION;
					serverOptions.siteLanguage = DEFAULT_LOCALE;
					serverOptions.isSetupMode = false;
					serverOptions.isWpAutoUpdating = true;
					serverOptions.blueprint = undefined;
				} catch ( error ) {
					throw new Error(
						`Failed to copy WordPress files for offline setup: ${ ( error as Error ).message }`
					);
				}
			}

			const sqliteStartTime = Date.now();
			await keepSqliteIntegrationUpdated( path );
			console.log( `[PERF] setupWordPressSite: SQLite integration update took ${ Date.now() - sqliteStartTime }ms` );

			const serverInstanceStart = Date.now();
			const serverInstance = await this.startServer( serverOptions );
			console.log( `[PERF] setupWordPressSite: startServer took ${ Date.now() - serverInstanceStart }ms` );

			const processCreateStart = Date.now();
			serverProcess = this.createServerProcess( serverInstance );
			console.log( `[PERF] setupWordPressSite: createServerProcess took ${ Date.now() - processCreateStart }ms` );

			const processStartTime = Date.now();
			await serverProcess.start();
			console.log( `[PERF] setupWordPressSite: serverProcess.start took ${ Date.now() - processStartTime }ms` );

			if ( ! serverOptions.isSetupMode ) {
				const installStartTime = Date.now();
				await this.runWordPressInstallation( serverProcess, serverOptions );
				console.log( `[PERF] setupWordPressSite: WordPress installation took ${ Date.now() - installStartTime }ms` );
			}

			// remove blueprint since we only want to run it once
			server.meta.blueprint = undefined;

			console.log( `[PERF] setupWordPressSite: Total setup time ${ Date.now() - setupStartTime }ms` );
			return true;
		} catch ( error ) {
			console.error( 'Failed to setup WordPress site:', error );
			throw error;
		} finally {
			const stopStart = Date.now();
			await serverProcess?.stop();
			console.log( `[PERF] setupWordPressSite: Stop server took ${ Date.now() - stopStart }ms` );
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
	 * Properly escape a string for safe use in PHP code
	 */
	private escapePhpString( str: string ): string {
		return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
	}

	/**
	 * Run WordPress installation steps directly to avoid web-based setup wizard
	 */
	private async runWordPressInstallation(
		serverProcess: WordPressServerProcess,
		options: {
			path: string;
			port: number;
			adminPassword: string;
			siteTitle: string;
			siteLanguage: string;
		}
	): Promise< void > {
		await serverProcess.runPhp( {
			code: `<?php
					$_POST = array(
						'language' => '${ this.escapePhpString( options.siteLanguage ) }',
						'prefix' => 'wp_',
						'weblog_title' => '${ this.escapePhpString( options.siteTitle ) }',
						'user_name' => 'admin',
						'admin_password' => '${ this.escapePhpString( options.adminPassword ) }',
						'admin_password2' => '${ this.escapePhpString( options.adminPassword ) }',
						'Submit' => 'Install WordPress',
						'pw_weak' => '1',
						'admin_email' => 'admin@localhost.com',
					);
					$_REQUEST = $_POST;
					$_GET['step'] = 2;

					// Include WordPress installation
					require_once('/wordpress/wp-admin/install.php');
				`,
		} );
	}
}
