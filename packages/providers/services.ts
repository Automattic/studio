import { anthropicServices } from './anthropic/services';
import { geminiServices } from './gemini/services';
import { githubCopilotServices } from './github-copilot/services';
import { localLlmServices } from './local-llm/services';
import { metaServices } from './meta/services';
import { openaiServices } from './openai/services';
import { openrouterServices } from './openrouter/services';
import { spacefastServices } from './spacefast/services';
import { sshServices } from './ssh/services';
import { wpcomServices } from './wpcom/services';
import { xaiServices } from './xai/services';
import type { ProviderConfigs, ProviderId, ProviderServices, ProviderSite } from './types';

const SERVICES: {
	[ Id in ProviderId ]: ProviderServices< ProviderConfigs[ Id ], ProviderSite< Id > >;
} = {
	wpcom: wpcomServices,
	anthropic: anthropicServices,
	openai: openaiServices,
	gemini: geminiServices,
	'github-copilot': githubCopilotServices,
	meta: metaServices,
	xai: xaiServices,
	openrouter: openrouterServices,
	spacefast: spacefastServices,
	'local-llm': localLlmServices,
	ssh: sshServices,
};

export function getProviderServices< Id extends ProviderId >(
	id: Id
): ProviderServices< ProviderConfigs[ Id ], ProviderSite< Id > > {
	return SERVICES[ id ];
}
