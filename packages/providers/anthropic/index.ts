import { anthropicAccount } from './account';
import { anthropicAi } from './ai';
import { anthropicDescriptor } from './descriptor';
import type { AnthropicConfig } from './config';
import type { Provider } from '../types';

export const anthropicProvider: Provider< AnthropicConfig > = {
	descriptor: anthropicDescriptor,
	account: anthropicAccount,
	ai: anthropicAi,
};
