import { metaAccount } from './account';
import { metaAi } from './ai';
import type { MetaConfig } from './config';
import type { ProviderServices } from '../types';

export const metaServices: ProviderServices< MetaConfig > = {
	id: 'meta',
	account: metaAccount,
	ai: metaAi,
};
