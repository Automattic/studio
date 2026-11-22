import { localLlmAccount } from './account';
import { localLlmAi } from './ai';
import type { LocalLlmConfig } from './config';
import type { ProviderServices } from '../types';

export const localLlmServices: ProviderServices< LocalLlmConfig > = {
	id: 'local-llm',
	account: localLlmAccount,
	ai: localLlmAi,
};
