import type { WPNowOptions } from 'vendor/wp-now/src/config';

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
	setupWordPressSite( path: string, wpVersion?: string ): Promise< boolean >;
	startServer( options: ServerOptions ): Promise< WordPressServerInstance >;
}
