import { SiteServer } from 'src/site-server';

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

export interface WordPressServerOptions {
	port?: number;
	phpVersion?: string;
	documentRoot?: string;
	absoluteUrl?: string;
	projectPath?: string;
	wpContentPath?: string;
	wordPressVersion?: string;
	isWpAutoUpdating?: boolean;
	adminPassword?: string;
	siteTitle?: string;
	siteLanguage?: string;
}

export interface WordPressServerInstance {
	url: string;
	options: WordPressServerOptions;
	// Internal options for server process implementation
	_internal?: unknown;
}

export interface WordPressServerProcess {
	url: string;
	php?: { documentRoot: string };
	start(): Promise< void >;
	stop(): Promise< void >;
	runPhp( data: { code: string; [ key: string ]: unknown } ): Promise< string >;
}

export interface WordPressProvider {
	readonly PROVIDER_TYPE: string;

	// Constants
	readonly DEFAULT_PHP_VERSION: string;
	readonly DEFAULT_WORDPRESS_VERSION: string;
	readonly ALLOWED_PHP_VERSIONS: string[];
	readonly SQLITE_FILENAME: string;
	readonly SQLITE_FILENAME_LEGACY: string;

	// Path utilities
	getSqlitePath(): string;

	// Download functionality
	downloadSQLiteCommand( downloadUrl: string, targetPath: string ): Promise< void >;

	// Core functionality
	setupWordPressSite( server: SiteServer, wpVersion?: string ): Promise< boolean >;
	startServer( options: ServerOptions ): Promise< WordPressServerInstance >;

	// Server process management
	createServerProcess( serverInstance: WordPressServerInstance ): WordPressServerProcess;

	// Version utilities
	isValidWordPressVersion( version: string ): boolean;

	// WP-CLI
	executeWPCli(
		projectPath: string,
		args: string[],
		options?: { phpVersion?: string }
	): Promise< {
		stdout: string;
		stderr: string;
		exitCode: number;
	} >;

	// Configuration
	getConfig( options: { path: string } ): Promise< { wpContentPath?: string } >;
}
