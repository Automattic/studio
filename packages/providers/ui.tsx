import { spacefastUi } from './spacefast/ui';
import { sshUi } from './ssh/ui';
import { wpcomUi } from './wpcom/ui';
import type { ProviderSites, ProviderUi, SitesProviderId } from './types';

const UI: { [ Id in SitesProviderId ]: ProviderUi< ProviderSites[ Id ] > } = {
	wpcom: wpcomUi,
	spacefast: spacefastUi,
	ssh: sshUi,
};

// What the provider looks like in the apps, beyond what its descriptor says.
export function getProviderUi( id: SitesProviderId ): ProviderUi {
	return UI[ id ] as ProviderUi;
}
