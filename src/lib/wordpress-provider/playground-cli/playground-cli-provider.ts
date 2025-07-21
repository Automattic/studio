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
}

export const PLAYGROUND_CLI_PROVIDER_NAME = 'playground-cli';

export class PlaygroundCliProvider implements WordPressProvider {
	readonly PROVIDER_TYPE = PLAYGROUND_CLI_PROVIDER_NAME;

	// Minimal required constants
	readonly DEFAULT_PHP_VERSION = '8.3';
	readonly DEFAULT_WORDPRESS_VERSION = '6.6';
	readonly ALLOWED_PHP_VERSIONS = [ '7.4', '8.0', '8.1', '8.2', '8.3' ];
	readonly SQLITE_FILENAME = 'database.sqlite';
	readonly SQLITE_FILENAME_LEGACY = 'db.sqlite';

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
	} ): Promise< WordPressServerInstance > {
		console.log( '[playground-cli] startServer called with options:', options );

		const port = options.port;
		const phpVersion = options.phpVersion || '8.3';

		const playgroundOptions: PlaygroundCliOptions = {
			port,
			phpVersion,
			documentRoot: options.path,
			autoMount: true,
			skipWordpressSetup: true,
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
		console.log(
			'[playground-cli] createServerProcess called with serverInstance:',
			serverInstance
		);

		const playgroundOptions = serverInstance._internal as PlaygroundCliOptions;
		return new PlaygroundServerProcess(
			serverInstance.url,
			playgroundOptions,
			serverInstance.options
		);
	}

	// Unsupported methods - throw errors to indicate they need different implementation
	getWordPressVersionPath( _version: string ): string {
		throw new Error( 'getWordPressVersionPath not implemented for playground-cli provider' );
	}

	getSqlitePath(): string {
		throw new Error( 'getSqlitePath not implemented for playground-cli provider' );
	}

	getWpCliPath(): string {
		throw new Error( 'getWpCliPath not implemented for playground-cli provider' );
	}

	getWpCliFolderPath(): string {
		throw new Error( 'getWpCliFolderPath not implemented for playground-cli provider' );
	}

	async downloadWordPress( _version?: string, _options?: { overwrite: boolean } ): Promise< void > {
		throw new Error( 'downloadWordPress not implemented for playground-cli provider' );
	}

	async downloadWpCli(
		_overwrite?: boolean
	): Promise< { downloaded: boolean; statusCode: number } > {
		throw new Error( 'downloadWpCli not implemented for playground-cli provider' );
	}

	async downloadSQLiteCommand( _downloadUrl: string, _targetPath: string ): Promise< void > {
		throw new Error( 'downloadSQLiteCommand not implemented for playground-cli provider' );
	}

	async setupWordPressSite( _path: string, _wpVersion?: string ): Promise< boolean > {
		// This is acceptable as a no-op since we assume the site is already set up
		return true;
	}

	async isWordPressVersionInstalled( _version: string ): Promise< boolean > {
		throw new Error( 'isWordPressVersionInstalled not implemented for playground-cli provider' );
	}

	isValidWordPressVersion( _version: string ): boolean {
		throw new Error( 'isValidWordPressVersion not implemented for playground-cli provider' );
	}

	async executeWPCli(
		_projectPath: string,
		_args: string[],
		_options?: { phpVersion?: string }
	): Promise< {
		stdout: string;
		stderr: string;
		exitCode: number;
	} > {
		throw new Error( 'executeWPCli not implemented for playground-cli provider' );
	}

	async getConfig( _options: { path: string } ): Promise< { wpContentPath?: string } > {
		throw new Error( 'getConfig not implemented for playground-cli provider' );
	}
}
