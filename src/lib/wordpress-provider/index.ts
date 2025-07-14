export * from './types';
export { WpNowProvider } from './wp-now-provider';

import { WpNowProvider } from './wp-now-provider';
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
