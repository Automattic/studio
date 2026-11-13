import { anthropicServices } from './anthropic/services';
import { openaiServices } from './openai/services';
import { spacefastServices } from './spacefast/services';
import { wpcomServices } from './wpcom/services';
import { xaiServices } from './xai/services';
import type { ProviderConfigs, ProviderId, ProviderServices, ProviderSite } from './types';

const SERVICES: {
	[ Id in ProviderId ]: ProviderServices< ProviderConfigs[ Id ], ProviderSite< Id > >;
} = {
	wpcom: wpcomServices,
	anthropic: anthropicServices,
	openai: openaiServices,
	xai: xaiServices,
	spacefast: spacefastServices,
};

export function getProviderServices< Id extends ProviderId >(
	id: Id
): ProviderServices< ProviderConfigs[ Id ], ProviderSite< Id > > {
	return SERVICES[ id ];
}

// Previews upload to WordPress.com the way a push does, until they are a capability of their own.
export { createTusUpload } from './wpcom/sites/upload';
