export * from './types';
export { WpNowProvider } from './wp-now';

import { WpNowProvider } from './wp-now';
import type { WordPressProvider } from './types';

let provider: WordPressProvider | null = null;
let providerType: string = 'wp-now'; // Default provider type

export function getWordPressProvider(): WordPressProvider {
	if ( ! provider ) {
		provider = new WpNowProvider();
		providerType = 'wp-now';
	}
	return provider;
}

export function getWordPressProviderType(): string {
	return providerType;
}

export const getProviderConstants = (
	provider: WordPressProvider
): {
	defaultPhpVersion: string;
	defaultWordPressVersion: string;
	allowedPhpVersions: string[];
} => {
	return {
		defaultPhpVersion: provider.DEFAULT_PHP_VERSION,
		defaultWordPressVersion: provider.DEFAULT_WORDPRESS_VERSION,
		allowedPhpVersions: provider.ALLOWED_PHP_VERSIONS,
	};
};

export function sendProviderConstantsChanged( provider: WordPressProvider ): void {
	// Notify renderer processes about provider constants changes
	try {
		const { sendIpcEventToRenderer } = require( 'src/ipc-utils' );
		const constants = {
			defaultPhpVersion: provider.DEFAULT_PHP_VERSION,
			defaultWordPressVersion: provider.DEFAULT_WORDPRESS_VERSION,
			allowedPhpVersions: provider.ALLOWED_PHP_VERSIONS,
		};
		sendIpcEventToRenderer( 'providerConstantsChanged', constants );
	} catch ( error ) {
		console.error( 'Error notifying renderer processes about provider constants changes:', error );
	}
}

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
