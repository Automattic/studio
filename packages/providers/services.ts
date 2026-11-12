import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { spacefastProvider } from './spacefast';
import { wpcomProvider } from './wpcom';
import type { Provider, ProviderConfigs, ProviderId, ProviderSite } from './types';

const PROVIDERS: {
	[ Id in ProviderId ]: Provider< ProviderConfigs[ Id ], ProviderSite< Id > >;
} = {
	wpcom: wpcomProvider,
	anthropic: anthropicProvider,
	openai: openaiProvider,
	spacefast: spacefastProvider,
};

export function getProvider< Id extends ProviderId >(
	id: Id
): Provider< ProviderConfigs[ Id ], ProviderSite< Id > > {
	return PROVIDERS[ id ];
}

// Previews upload to WordPress.com the way a push does, until they are a capability of their own.
export { createTusUpload } from './wpcom/sites/upload';
