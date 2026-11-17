import { customAccount } from './account';
import { customAi } from './ai';
import type { CustomConfig } from './config';
import type { ProviderServices } from '../types';

export const customServices: ProviderServices< CustomConfig > = {
	id: 'custom',
	account: customAccount,
	ai: customAi,
};
