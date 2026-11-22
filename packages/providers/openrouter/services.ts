import { openrouterAccount } from './account';
import { openrouterAi } from './ai';
import type { OpenrouterConfig } from './config';
import type { ProviderServices } from '../types';

export const openrouterServices: ProviderServices< OpenrouterConfig > = {
	id: 'openrouter',
	account: openrouterAccount,
	ai: openrouterAi,
};
