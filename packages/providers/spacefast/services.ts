import { spacefastAccount } from './account';
import { spacefastSites } from './sites';
import type { SpacefastConfig } from './config';
import type { Space } from './descriptor';
import type { ProviderServices } from '../types';

export const spacefastServices: ProviderServices< SpacefastConfig, Space > = {
	id: 'spacefast',
	account: spacefastAccount,
	sites: spacefastSites,
};
