import { net } from 'electron';
import { pathExists, recursiveCopyDirectory, isEmptyDir } from 'src/lib/fs-utils';
import { getPreferredSiteLanguage } from 'src/lib/site-language';
import { verifyWordPressChecksums, purgeWpConfig } from 'src/lib/wp-versions';
import { copyBundledLatestWPVersion } from 'src/setup-wp-server-files';
import { getWpNowConfig } from 'vendor/wp-now/src';
import { WPNowMode } from 'vendor/wp-now/src/config';
import {
	downloadWordPress,
	downloadWpCli,
	downloadSQLiteCommand,
} from 'vendor/wp-now/src/download';
import {
	DEFAULT_PHP_VERSION,
	DEFAULT_WORDPRESS_VERSION,
	ALLOWED_PHP_VERSIONS,
	SQLITE_FILENAME,
	SQLITE_FILENAME_LEGACY,
} from './constants';
import {
	getWordPressVersionPath,
	getSqlitePath,
	getWpCliPath,
	getWpCliFolderPath,
} from './path-utilities';
import type { WordPressProvider, ServerOptions, WordPressServerInstance } from '../types';

export class WpNowProvider implements WordPressProvider {
	// Constants
	readonly DEFAULT_PHP_VERSION = DEFAULT_PHP_VERSION;
	readonly DEFAULT_WORDPRESS_VERSION = DEFAULT_WORDPRESS_VERSION;
	readonly ALLOWED_PHP_VERSIONS = ALLOWED_PHP_VERSIONS;
	readonly SQLITE_FILENAME = SQLITE_FILENAME;
	readonly SQLITE_FILENAME_LEGACY = SQLITE_FILENAME_LEGACY;

	// Path utilities
	getWordPressVersionPath( version: string ): string {
		return getWordPressVersionPath( version );
	}

	getSqlitePath(): string {
		return getSqlitePath();
	}

	getWpCliPath(): string {
		return getWpCliPath();
	}

	getWpCliFolderPath(): string {
		return getWpCliFolderPath();
	}

	async downloadWordPress( version?: string, options?: { overwrite: boolean } ): Promise< void > {
		await downloadWordPress( version, options );
	}

	async downloadWpCli(
		overwrite?: boolean
	): Promise< { downloaded: boolean; statusCode: number } > {
		return await downloadWpCli( overwrite );
	}

	async downloadSQLiteCommand( downloadUrl: string, targetPath: string ): Promise< void > {
		await downloadSQLiteCommand( downloadUrl, targetPath );
	}

	async setupWordPressSite( path: string, wpVersion = 'latest' ): Promise< boolean > {
		try {
			if ( ( await pathExists( path ) ) && ! ( await isEmptyDir( path ) ) ) {
				// We can only create into a clean directory
				return false;
			}

			const wpVersionPath = this.getWordPressVersionPath( wpVersion );
			const wpVersionExists = await pathExists( wpVersionPath );

			if ( ! wpVersionExists ) {
				if ( net.isOnline() ) {
					try {
						await this.downloadWordPress( wpVersion, { overwrite: false } );
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

			await verifyWordPressChecksums( wpVersion );
			await purgeWpConfig( wpVersion );
			await recursiveCopyDirectory( this.getWordPressVersionPath( wpVersion ), path );

			return true;
		} catch ( error ) {
			console.error( 'Error in setupWordPressSite:', error );
			throw error;
		}
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

		return {
			url: options.absoluteUrl || `http://localhost:${ wpNowOptions.port }`,
			options: wpNowOptions,
		};
	}
}
