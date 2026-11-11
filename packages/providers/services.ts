import { anthropicProvider } from './anthropic';
import { wpcomProvider } from './wpcom';
import type { Provider, ProviderConfigs, ProviderId } from './types';

const PROVIDERS: { [ Id in ProviderId ]: Provider< ProviderConfigs[ Id ] > } = {
	wpcom: wpcomProvider,
	anthropic: anthropicProvider,
};

export function getProvider< Id extends ProviderId >( id: Id ): Provider< ProviderConfigs[ Id ] > {
	return PROVIDERS[ id ];
}
