export * from './types';
export { WpNowProvider } from './wp-now';

import { WpNowProvider } from './wp-now';
import type { WordPressProvider } from './types';

let provider: WordPressProvider | null = null;

export function getWordPressProvider(): WordPressProvider {
	if ( ! provider ) {
		provider = new WpNowProvider();
	}
	return provider;
}

export function setWordPressProvider( newProvider: WordPressProvider ): void {
	provider = newProvider;
}

const activeProvider = getWordPressProvider();

export const DEFAULT_PHP_VERSION = activeProvider.DEFAULT_PHP_VERSION;
export const DEFAULT_WORDPRESS_VERSION = activeProvider.DEFAULT_WORDPRESS_VERSION;
export const ALLOWED_PHP_VERSIONS = activeProvider.ALLOWED_PHP_VERSIONS;
export const SQLITE_FILENAME = activeProvider.SQLITE_FILENAME;
export const SQLITE_FILENAME_LEGACY = activeProvider.SQLITE_FILENAME_LEGACY;

export const getWordPressVersionPath =
	activeProvider.getWordPressVersionPath.bind( activeProvider );
export const getSqlitePath = activeProvider.getSqlitePath.bind( activeProvider );
export const getWpCliPath = activeProvider.getWpCliPath.bind( activeProvider );
export const getWpCliFolderPath = activeProvider.getWpCliFolderPath.bind( activeProvider );
