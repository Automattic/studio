import { openaiAccount } from './account';
import { openaiAi } from './ai';
import type { OpenaiConfig } from './config';
import type { ProviderServices } from '../types';

export const openaiServices: ProviderServices< OpenaiConfig > = {
	id: 'openai',
	account: openaiAccount,
	ai: openaiAi,
};
