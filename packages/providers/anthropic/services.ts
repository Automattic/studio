import { anthropicAccount } from './account';
import { anthropicAi } from './ai';
import type { AnthropicConfig } from './config';
import type { ProviderServices } from '../types';

export const anthropicServices: ProviderServices< AnthropicConfig > = {
	id: 'anthropic',
	account: anthropicAccount,
	ai: anthropicAi,
};
