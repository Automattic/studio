import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { wpcomProvider } from './wpcom';
import type { Provider, ProviderConfigs, ProviderId } from './types';

const PROVIDERS: { [ Id in ProviderId ]: Provider< ProviderConfigs[ Id ] > } = {
	wpcom: wpcomProvider,
	anthropic: anthropicProvider,
	gemini: geminiProvider,
};

export function getProvider< Id extends ProviderId >( id: Id ): Provider< ProviderConfigs[ Id ] > {
	return PROVIDERS[ id ];
}
