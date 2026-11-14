import { wpcomAccount } from './account';
import { wpcomAi } from './ai';
import { wpcomSites } from './sites';
import type { WpcomConfig } from './config';
import type { ProviderServices } from '../types';
import type { SyncSite } from './sites/site';

export const wpcomServices: ProviderServices< WpcomConfig, SyncSite > = {
	id: 'wpcom',
	account: wpcomAccount,
	ai: wpcomAi,
	sites: wpcomSites,
};
