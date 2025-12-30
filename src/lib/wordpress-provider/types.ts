import { SiteServer } from 'src/site-server';
import { Blueprint } from 'src/stores/wpcom-api';

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
	blueprint?: Blueprint[ 'blueprint' ];
	enableXdebug?: boolean;
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
	isSetupMode?: boolean;
}

export interface WordPressServerInstance {
	url: string;
	options: WordPressServerOptions;
	// Internal options for server process implementation
	_internal?: unknown;
}

export interface WordPressServerProcess {
	url: string;
	php?: {
		documentRoot: string;
		request?: ( options: {
			url: string;
			method: string;
			body: Record< string, string >;
		} ) => Promise< { text: string } >;
	};
	start( siteId?: string ): Promise< void >;
	stop(): Promise< void >;
	runPhp( data: { code: string; [ key: string ]: unknown } ): Promise< string >;
}

export interface WordPressProvider {
	readonly PROVIDER_TYPE: string;

	// Constants
	readonly DEFAULT_PHP_VERSION: string;
	readonly DEFAULT_WORDPRESS_VERSION: string;
	readonly ALLOWED_PHP_VERSIONS: string[];
	readonly MINIMUM_WORDPRESS_VERSION: string;
	readonly SQLITE_FILENAME: string;

	// Path utilities
	getSqlitePath(): string;
	getWpLoadPath( serverProcess: WordPressServerProcess ): string;

	// Core functionality
	setupWordPressSite( server: SiteServer, wpVersion?: string ): Promise< boolean >;
	setupWordPressFilesOnly( path: string ): Promise< void >;
	installWordPressWhenNoWpConfig(
		server: SiteServer,
		siteName: string,
		adminPassword: string
	): Promise< void >;
	startServer( options: ServerOptions ): Promise< WordPressServerInstance >;

	// Server process management
	createServerProcess( serverInstance: WordPressServerInstance ): WordPressServerProcess;

	// Version utilities
	isValidWordPressVersion( version: string ): boolean;
}
