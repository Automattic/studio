import { anthropicProvider } from './anthropic';
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
};

export function getProvider< Id extends ProviderId >(
	id: Id
): Provider< ProviderConfigs[ Id ], ProviderSite< Id > > {
	return PROVIDERS[ id ];
}

export { wpcomClient } from './wpcom/client';
export { createTusUpload } from './wpcom/sites/upload';
