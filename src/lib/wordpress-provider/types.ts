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
	siteId?: string; // Add siteId for instance tracking
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
	siteId?: string; // Add siteId for instance tracking
	isReused?: boolean; // Flag to indicate if this is a reused instance
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
	getWpLoadPath( serverProcess: WordPressServerProcess ): string;

	// Core functionality
	setupWordPressSite( server: SiteServer, wpVersion?: string ): Promise< boolean >;
	startServer( options: ServerOptions ): Promise< WordPressServerInstance >;

	// Server process management
	createServerProcess( serverInstance: WordPressServerInstance ): WordPressServerProcess;

	// Version utilities
	isValidWordPressVersion( version: string ): boolean;

	// Configuration
	getConfig( options: { path: string } ): Promise< { wpContentPath?: string } >;

	// Instance management (optional - only for providers that manage instances)
	cleanupInstance?( siteId: string ): Promise< void >;
	cleanupAllInstances?(): Promise< void >;
}
