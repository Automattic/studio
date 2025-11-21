import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { pathExists, recursiveCopyDirectory, isEmptyDir } from 'common/lib/fs-utils';
import { isOnline } from 'common/lib/network-utils';
import { getPreferredSiteLanguage } from 'src/lib/site-language';
import { isValidWordPressVersion } from 'src/lib/wordpress-version-utils';
import { copyBundledLatestWPVersion } from 'src/setup-wp-server-files';
import { SiteServer } from 'src/site-server';
import { getWpNowConfig } from 'vendor/wp-now/src';
import { WPNowMode } from 'vendor/wp-now/src/config';
import {
	downloadWordPress,
	downloadWpCli,
	downloadSQLiteCommand,
} from 'vendor/wp-now/src/download';
import { executeWPCli } from 'vendor/wp-now/src/execute-wp-cli';
import {
	DEFAULT_PHP_VERSION,
	DEFAULT_WORDPRESS_VERSION,
	ALLOWED_PHP_VERSIONS,
	SQLITE_FILENAME,
} from '../constants';
import {
	getWordPressVersionPath,
	getSqlitePath,
	getWpCliPath,
	getWpCliFolderPath,
} from './path-utilities';
import SiteServerProcess from './site-server-process';
import type {
	WordPressProvider,
	ServerOptions,
	WordPressServerInstance,
	WordPressServerOptions,
	WordPressServerProcess,
} from '../types';
import type { WPNowOptions } from 'vendor/wp-now/src/config';

export class WpNowProvider implements WordPressProvider {
	readonly PROVIDER_TYPE = 'wp-now';

	// Constants
	static readonly DEFAULT_PHP_VERSION = DEFAULT_PHP_VERSION;
	static readonly DEFAULT_WORDPRESS_VERSION = DEFAULT_WORDPRESS_VERSION;
	static readonly ALLOWED_PHP_VERSIONS = ALLOWED_PHP_VERSIONS;
	static readonly MINIMUM_WORDPRESS_VERSION = '6.2.6';
	static readonly SQLITE_FILENAME = SQLITE_FILENAME;

	// Instance constants for interface compatibility
	readonly DEFAULT_PHP_VERSION = WpNowProvider.DEFAULT_PHP_VERSION;
	readonly DEFAULT_WORDPRESS_VERSION = WpNowProvider.DEFAULT_WORDPRESS_VERSION;
	readonly ALLOWED_PHP_VERSIONS = WpNowProvider.ALLOWED_PHP_VERSIONS;
	readonly MINIMUM_WORDPRESS_VERSION = WpNowProvider.MINIMUM_WORDPRESS_VERSION;
	readonly SQLITE_FILENAME = WpNowProvider.SQLITE_FILENAME;

	// Path utilities (static methods for setup use)
	static getWordPressVersionPath( version: string ): string {
		return getWordPressVersionPath( version );
	}

	static getWpCliPath(): string {
		return getWpCliPath();
	}

	static getWpCliFolderPath(): string {
		return getWpCliFolderPath();
	}

	getSqlitePath(): string {
		return getSqlitePath();
	}

	getWpLoadPath( serverProcess: WordPressServerProcess ): string {
		return `${ serverProcess.php?.documentRoot }/wp-load.php`;
	}

	getWpCliPath(): string {
		return WpNowProvider.getWpCliPath();
	}

	getWpCliFolderPath(): string {
		return WpNowProvider.getWpCliFolderPath();
	}

	static async downloadWordPress(
		version?: string,
		options?: { overwrite: boolean }
	): Promise< void > {
		await downloadWordPress( version, options );
	}

	static async downloadWpCli(
		overwrite?: boolean
	): Promise< { downloaded: boolean; statusCode: number } > {
		return await downloadWpCli( overwrite );
	}

	async downloadWpCli(
		overwrite?: boolean
	): Promise< { downloaded: boolean; statusCode: number } > {
		return await WpNowProvider.downloadWpCli( overwrite );
	}

	async downloadSQLiteCommand( downloadUrl: string, targetPath: string ): Promise< void > {
		await downloadSQLiteCommand( downloadUrl, targetPath );
	}

	async setupWordPressSite( server: SiteServer, wpVersion = 'latest' ): Promise< boolean > {
		try {
			const { path } = server.details;
			if ( ( await pathExists( path ) ) && ! ( await isEmptyDir( path ) ) ) {
				// We can only create into a clean directory
				return false;
			}

			const wpVersionPath = WpNowProvider.getWordPressVersionPath( wpVersion );
			const wpVersionExists = await pathExists( wpVersionPath );

			if ( ! wpVersionExists ) {
				if ( await isOnline() ) {
					try {
						await WpNowProvider.downloadWordPress( wpVersion, { overwrite: false } );
					} catch ( error ) {
						console.error( `Failed to download WordPress version ${ wpVersion }:`, error );
						throw new Error(
							`Failed to download WordPress version ${ wpVersion }. Please try a different version.`
						);
					}
				} else if ( wpVersion === 'latest' ) {
					await copyBundledLatestWPVersion();
				} else {
					return false;
				}
			}

			await this.verifyWordPressChecksums( wpVersion );
			await this.purgeWpConfig( wpVersion );
			await recursiveCopyDirectory( WpNowProvider.getWordPressVersionPath( wpVersion ), path );

			return true;
		} catch ( error ) {
			console.error( 'Error in setupWordPressSite:', error );
			throw error;
		}
	}

	async setupWordPressFilesOnly( _path: string ): Promise< void > {
		// No-op for wp-now provider
	}

	async installWordPressWhenNoWpConfig(
		_server: SiteServer,
		_siteName: string,
		_adminPassword: string
	): Promise< void > {
		// wp-now handles WordPress installation automatically via installationSteps
		// in vendor/wp-now/src/wp-now.ts, so no action needed here
	}

	async startServer( options: ServerOptions ): Promise< WordPressServerInstance > {
		const wpNowOptions = await getWpNowConfig( {
			path: options.path,
			port: options.port,
			adminPassword: options.adminPassword,
			siteTitle: options.siteTitle,
			php: options.phpVersion,
			wp: options.wpVersion,
			isWpAutoUpdating: options.isWpAutoUpdating,
		} );

		if ( options.absoluteUrl ) {
			wpNowOptions.absoluteUrl = options.absoluteUrl;
		}

		if ( options.siteLanguage ) {
			wpNowOptions.siteLanguage = options.siteLanguage;
		} else {
			wpNowOptions.siteLanguage = await getPreferredSiteLanguage( wpNowOptions.wordPressVersion );
		}

		if ( wpNowOptions.mode !== WPNowMode.WORDPRESS ) {
			throw new Error(
				`Site server started with Playground's '${ wpNowOptions.mode }' mode. Studio only supports 'wordpress' mode.`
			);
		}

		// Map wp-now options to provider-agnostic options
		const providerOptions: WordPressServerOptions = {
			port: wpNowOptions.port,
			phpVersion: wpNowOptions.phpVersion,
			documentRoot: wpNowOptions.documentRoot,
			absoluteUrl: wpNowOptions.absoluteUrl,
			projectPath: wpNowOptions.projectPath,
			wpContentPath: wpNowOptions.wpContentPath,
			wordPressVersion: wpNowOptions.wordPressVersion,
			isWpAutoUpdating: wpNowOptions.isWpAutoUpdating,
			adminPassword: wpNowOptions.adminPassword,
			siteTitle: wpNowOptions.siteTitle,
			siteLanguage: wpNowOptions.siteLanguage,
		};

		return {
			url: options.absoluteUrl || `http://localhost:${ wpNowOptions.port }`,
			options: providerOptions,
			_internal: wpNowOptions,
		};
	}

	async executeWPCli(
		projectPath: string,
		args: string[],
		options?: { phpVersion?: string }
	): Promise< { stdout: string; stderr: string; exitCode: number } > {
		return await executeWPCli( projectPath, args, options );
	}

	isValidWordPressVersion( version: string ): boolean {
		return isValidWordPressVersion( version );
	}

	createServerProcess( serverInstance: WordPressServerInstance ): WordPressServerProcess {
		return new SiteServerProcess( serverInstance._internal as WPNowOptions );
	}

	/**
	 * Deletes the wp-config.php file at the specified path.
	 *
	 * Prior to enforcing Playground's WordPress mode, it was possible to run
	 * alternative modes, which mutated Studio's bundled WordPress installation.
	 * To rectify the situation, we remove the erroneous wp-config.php file.
	 *
	 * If we are confident this situation is not a widespread issue, we can remove
	 * this function in the future.
	 *
	 * @param wpVersion - The WordPress version the wp-config.php file.
	 */
	private async purgeWpConfig( wpVersion: string ): Promise< void > {
		const wpVersionPath = WpNowProvider.getWordPressVersionPath( wpVersion );
		const wpConfigPath = path.join( wpVersionPath, 'wp-config.php' );

		if ( ! ( await pathExists( wpConfigPath ) ) ) {
			return;
		}

		await fs.promises.unlink( wpConfigPath );
	}

	/**
	 * Verifies the checksums of a WordPress installation.
	 * If checksums don't match, it will retry the download once.
	 *
	 * @param wpVersion - The WordPress version to verify
	 */
	private async verifyWordPressChecksums( wpVersion: string ): Promise< void > {
		if ( ! ( await isOnline() ) ) {
			console.log( 'Skipping WordPress checksum verification - offline mode' );
			return;
		}

		try {
			console.log( `Verifying checksums for WordPress version ${ wpVersion }...` );
			const result = await this.executeWPCli( WpNowProvider.getWordPressVersionPath( wpVersion ), [
				'core',
				'verify-checksums',
				'--skip-plugins',
				'--skip-themes',
			] );

			if ( result.exitCode !== 0 ) {
				console.log( `Checksums don't match for WordPress ${ wpVersion }, retrying download...` );
				await fs.remove( WpNowProvider.getWordPressVersionPath( wpVersion ) );
				// Retry download one more time
				await WpNowProvider.downloadWordPress( wpVersion, { overwrite: true } );
			}
		} catch ( error ) {
			console.error( `Failed to verify WordPress checksums:`, error );
			throw error;
		}
	}

	// WP-CLI Version Management
	async updateLatestWPCliVersion() {
		let shouldOverwrite = false;
		const pathExist = await fs.pathExists( WpNowProvider.getWpCliPath() );
		if ( pathExist ) {
			shouldOverwrite = await this.isWPCliInstallationOutdated();
		}
		await WpNowProvider.downloadWpCli( shouldOverwrite );
	}

	async isWPCliInstallationOutdated(): Promise< boolean > {
		const installedVersion = await this.getWPCliVersionFromInstallation();
		const latestVersion = await this.getLatestWPCliVersion();

		if ( ! installedVersion ) {
			return true;
		}

		if ( ! latestVersion ) {
			return false;
		}

		try {
			return semver.lt( installedVersion, latestVersion );
		} catch ( _error ) {
			return false;
		}
	}

	private latestWPCliVersionCache: string | null = null;

	private async getLatestWPCliVersion() {
		// Only fetch the latest version once per app session
		if ( this.latestWPCliVersionCache ) {
			return this.latestWPCliVersionCache;
		}

		try {
			const response = await fetch(
				'https://api.github.com/repos/wp-cli/wp-cli/releases?per_page=1'
			);
			const data: Record< string, string >[] = await response.json();
			this.latestWPCliVersionCache = data?.[ 0 ]?.tag_name || '';
		} catch ( _error ) {
			// Discard the failed fetch, return the cache
		}

		return this.latestWPCliVersionCache || '';
	}

	async getWPCliVersionFromInstallation(): Promise< string > {
		/**
		 * Version checks don't require a project folder to be mounted for WP-cli
		 * to execute a version check.
		 */
		const { stdout } = await this.executeWPCli( WpNowProvider.getWpCliFolderPath(), [
			'--version',
		] );

		if ( stdout?.startsWith( 'WP-CLI ' ) ) {
			const version = stdout.split( ' ' )[ 1 ];
			if ( ! version ) {
				return '';
			}
			return `v${ version }`;
		}
		return '';
	}
}
