import { xaiAccount } from './account';
import { xaiAi } from './ai';
import type { XaiConfig } from './config';
import type { ProviderServices } from '../types';

export const xaiServices: ProviderServices< XaiConfig > = {
	id: 'xai',
	account: xaiAccount,
	ai: xaiAi,
};
