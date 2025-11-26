export * from './types';
export { WpNowProvider } from './wp-now';
export { PlaygroundCliProvider, PLAYGROUND_CLI_PROVIDER_NAME } from './playground-cli';

import { getFeatureFlagFromEnv } from 'src/lib/feature-flags';
import { PlaygroundCliProvider } from './playground-cli/playground-cli-provider';
import { WpNowProvider } from './wp-now';
import type { WordPressProvider } from './types';

let provider: WordPressProvider | null = null;

export function getWordPressProvider(): WordPressProvider {
	const blueprintsEnabled = getFeatureFlagFromEnv( 'enableBlueprints' );

	if ( blueprintsEnabled ) {
		if ( provider?.PROVIDER_TYPE !== 'playground-cli' ) {
			provider = new PlaygroundCliProvider();
		}
		return provider;
	}

	// If blueprints are disabled, ensure we use WpNowProvider
	if ( provider?.PROVIDER_TYPE !== 'wp-now' ) {
		provider = new WpNowProvider();
	}

	return provider;
}

export function getWordPressProviderType(): string {
	const blueprintsEnabled = getFeatureFlagFromEnv( 'enableBlueprints' );
	return blueprintsEnabled ? 'playground-cli' : 'wp-now';
}

export const getProviderConstants = (
	provider: WordPressProvider
): {
	defaultPhpVersion: string;
	defaultWordPressVersion: string;
	allowedPhpVersions: string[];
	minimumWordPressVersion: string;
} => {
	return {
		defaultPhpVersion: provider.DEFAULT_PHP_VERSION,
		defaultWordPressVersion: provider.DEFAULT_WORDPRESS_VERSION,
		allowedPhpVersions: provider.ALLOWED_PHP_VERSIONS,
		minimumWordPressVersion: provider.MINIMUM_WORDPRESS_VERSION,
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
export const getSqlitePath = ( ...args: Parameters< WordPressProvider[ 'getSqlitePath' ] > ) =>
	getWordPressProvider().getSqlitePath( ...args );

export const getWpLoadPath = ( ...args: Parameters< WordPressProvider[ 'getWpLoadPath' ] > ) =>
	getWordPressProvider().getWpLoadPath( ...args );

export const setupWordPressSite = (
	...args: Parameters< WordPressProvider[ 'setupWordPressSite' ] >
) => getWordPressProvider().setupWordPressSite( ...args );
export const installWordPressWhenNoWpConfig = (
	...args: Parameters< WordPressProvider[ 'installWordPressWhenNoWpConfig' ] >
) => getWordPressProvider().installWordPressWhenNoWpConfig( ...args );
export const startServer = ( ...args: Parameters< WordPressProvider[ 'startServer' ] > ) =>
	getWordPressProvider().startServer( ...args );
export const isValidWordPressVersion = (
	...args: Parameters< WordPressProvider[ 'isValidWordPressVersion' ] >
) => getWordPressProvider().isValidWordPressVersion( ...args );
export const createServerProcess = (
	...args: Parameters< WordPressProvider[ 'createServerProcess' ] >
) => getWordPressProvider().createServerProcess( ...args );
