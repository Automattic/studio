import { net } from 'electron';
import nodePath from 'path';
import { SupportedPHPVersions } from '@php-wasm/universal';
import { Blueprint } from '@wp-playground/blueprints';
import { RecommendedPHPVersion } from '@wp-playground/common';
import { recursiveCopyDirectory, pathExists, isWordPressDirectory } from 'common/lib/fs-utils';
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
		wpCliPharPath?: string;
		blueprint?: Blueprint;
	} ): Promise< WordPressServerInstance > {
		const port = options.port;
		const phpVersion = options.phpVersion || '8.3';
		const hasWordPress = isWordPressDirectory( options.path );

		const playgroundOptions: PlaygroundCliOptions = {
			port,
			phpVersion,
			documentRoot: options.path,
			autoMount: true,
			skipWordpressSetup: hasWordPress,
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

	private escapePhpString( str: string ): string {
		return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
	}

	async setupWordPressSite( server: SiteServer, wpVersion = 'latest' ): Promise< boolean > {
		const { path, name, adminPassword } = server.details;

		try {
			const isOnline = net.isOnline();
			const siteLanguage = await getPreferredSiteLanguage( wpVersion );

			const setupSteps = [];

			if ( isOnline && siteLanguage && siteLanguage !== DEFAULT_LOCALE ) {
				setupSteps.push(
					{
						step: 'setSiteLanguage',
						language: siteLanguage,
					},
					{
						step: 'setSiteOptions',
						options: {
							WPLANG: siteLanguage,
						},
					}
				);
			}

			if ( name ) {
				setupSteps.push( {
					step: 'setSiteOptions',
					options: {
						blogname: name,
					},
				} );
			}

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
						`Failed to copy WordPress files for offline setup: ${ ( error as Error ).message }`
					);
				}

				setupSteps.push( {
					step: 'runPHP',
					code: `<?php
					$_POST = array(
						'language' => '${ this.escapePhpString( DEFAULT_LOCALE ) }',
						'prefix' => 'wp_',
						'weblog_title' => '${ this.escapePhpString( name ) }',
						'user_name' => 'admin',
						'admin_password' => '${ this.escapePhpString( adminPassword || '' ) }',
						'admin_password2' => '${ this.escapePhpString( adminPassword || '' ) }',
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

			if ( ! server.meta.blueprint ) {
				server.meta.blueprint = {};
			}
			const existingSteps = ( server.meta.blueprint.steps as unknown[] ) || [];
			server.meta.blueprint.steps = [ ...setupSteps, ...existingSteps ];

			await keepSqliteIntegrationUpdated( path );

			return true;
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
}
