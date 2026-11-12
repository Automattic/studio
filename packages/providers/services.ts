import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { wpcomProvider } from './wpcom';
import type { Provider, ProviderConfigs, ProviderId, ProviderSites, RemoteSite } from './types';

type ProviderSite< Id extends ProviderId > = Id extends keyof ProviderSites
	? ProviderSites[ Id ]
	: RemoteSite;

const PROVIDERS: {
	[ Id in ProviderId ]: Provider< ProviderConfigs[ Id ], ProviderSite< Id > >;
} = {
	wpcom: wpcomProvider,
	anthropic: anthropicProvider,
	gemini: geminiProvider,
};

export function getProvider< Id extends ProviderId >(
	id: Id
): Provider< ProviderConfigs[ Id ], ProviderSite< Id > > {
	return PROVIDERS[ id ];
}

// Previews upload to WordPress.com the way a push does, until they are a capability of their own.
export { createTusUpload } from './wpcom/sites/upload';
