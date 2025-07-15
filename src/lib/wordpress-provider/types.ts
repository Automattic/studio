import type { WPNowOptions } from 'vendor/wp-now/src/config';

export type AllowedPHPVersion = string;

export interface ServerOptions {
	path: string;
	port: number;
	adminPassword: string;
	siteTitle: string;
	phpVersion?: string;
	wpVersion?: string;
	isWpAutoUpdating?: boolean;
	absoluteUrl?: string;
	siteLanguage?: string;
}

export interface WordPressServerInstance {
	url: string;
	options: WPNowOptions;
}

export interface WordPressProvider {
	// Constants
	readonly DEFAULT_PHP_VERSION: string;
	readonly DEFAULT_WORDPRESS_VERSION: string;
	readonly ALLOWED_PHP_VERSIONS: string[];
	readonly SQLITE_FILENAME: string;
	readonly SQLITE_FILENAME_LEGACY: string;

	// Path utilities
	getWordPressVersionPath( version: string ): string;
	getSqlitePath(): string;
	getWpCliPath(): string;
	getWpCliFolderPath(): string;

	// Download functionality
	downloadWordPress( version?: string, options?: { overwrite: boolean } ): Promise< void >;
	downloadWpCli( overwrite?: boolean ): Promise< { downloaded: boolean; statusCode: number } >;
	downloadSQLiteCommand( downloadUrl: string, targetPath: string ): Promise< void >;

	// Core functionality
	setupWordPressSite( path: string, wpVersion?: string ): Promise< boolean >;
	startServer( options: ServerOptions ): Promise< WordPressServerInstance >;
}
