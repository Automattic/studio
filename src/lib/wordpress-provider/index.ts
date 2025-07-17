export * from './types';
export { WpNowProvider } from './wp-now';

import { WpNowProvider } from './wp-now';
import type { WordPressProvider } from './types';

let provider: WordPressProvider | null = null;
let providerType: string = 'wp-now'; // Default provider type

export function getWordPressProvider(): WordPressProvider {
	if ( ! provider ) {
		provider = new WpNowProvider();
	}
	return provider;
}

export function getWordPressProviderType(): string {
	return providerType;
}

export function setWordPressProvider( newProvider: WordPressProvider, type?: string ): void {
	provider = newProvider;
	if ( type ) {
		providerType = type;
	}

	// Notify renderer processes about provider constants changes
	try {
		const { sendIpcEventToRenderer } = require( 'src/ipc-utils' );
		const constants = {
			defaultPhpVersion: DEFAULT_PHP_VERSION(),
			defaultWordPressVersion: DEFAULT_WORDPRESS_VERSION(),
			allowedPhpVersions: ALLOWED_PHP_VERSIONS(),
		};
		sendIpcEventToRenderer( 'providerConstantsChanged', constants );
	} catch ( error ) {
		// Ignore errors in case this is called from renderer process
	}
}

// Constants as functions to allow runtime provider switching
export const DEFAULT_PHP_VERSION = () => getWordPressProvider().DEFAULT_PHP_VERSION;
export const DEFAULT_WORDPRESS_VERSION = () => getWordPressProvider().DEFAULT_WORDPRESS_VERSION;
export const ALLOWED_PHP_VERSIONS = () => getWordPressProvider().ALLOWED_PHP_VERSIONS;
export const SQLITE_FILENAME = () => getWordPressProvider().SQLITE_FILENAME;
export const SQLITE_FILENAME_LEGACY = () => getWordPressProvider().SQLITE_FILENAME_LEGACY;

// Methods as proxy functions
export const getWordPressVersionPath = (
	...args: Parameters< WordPressProvider[ 'getWordPressVersionPath' ] >
) => getWordPressProvider().getWordPressVersionPath( ...args );
export const getSqlitePath = ( ...args: Parameters< WordPressProvider[ 'getSqlitePath' ] > ) =>
	getWordPressProvider().getSqlitePath( ...args );
export const getWpCliPath = ( ...args: Parameters< WordPressProvider[ 'getWpCliPath' ] > ) =>
	getWordPressProvider().getWpCliPath( ...args );
export const getWpCliFolderPath = (
	...args: Parameters< WordPressProvider[ 'getWpCliFolderPath' ] >
) => getWordPressProvider().getWpCliFolderPath( ...args );

export const downloadWordPress = (
	...args: Parameters< WordPressProvider[ 'downloadWordPress' ] >
) => getWordPressProvider().downloadWordPress( ...args );
export const downloadWpCli = ( ...args: Parameters< WordPressProvider[ 'downloadWpCli' ] > ) =>
	getWordPressProvider().downloadWpCli( ...args );
export const downloadSQLiteCommand = (
	...args: Parameters< WordPressProvider[ 'downloadSQLiteCommand' ] >
) => getWordPressProvider().downloadSQLiteCommand( ...args );

export const setupWordPressSite = (
	...args: Parameters< WordPressProvider[ 'setupWordPressSite' ] >
) => getWordPressProvider().setupWordPressSite( ...args );
export const startServer = ( ...args: Parameters< WordPressProvider[ 'startServer' ] > ) =>
	getWordPressProvider().startServer( ...args );
export const executeWPCli = ( ...args: Parameters< WordPressProvider[ 'executeWPCli' ] > ) =>
	getWordPressProvider().executeWPCli( ...args );
export const isValidWordPressVersion = (
	...args: Parameters< WordPressProvider[ 'isValidWordPressVersion' ] >
) => getWordPressProvider().isValidWordPressVersion( ...args );
export const createServerProcess = (
	...args: Parameters< WordPressProvider[ 'createServerProcess' ] >
) => getWordPressProvider().createServerProcess( ...args );
export const getConfig = ( ...args: Parameters< WordPressProvider[ 'getConfig' ] > ) =>
	getWordPressProvider().getConfig( ...args );
