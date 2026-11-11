import { anthropicConfigSchema, type AnthropicConfig } from './config';
import type { AiModel, ProviderDescriptor } from '../types';

export const ANTHROPIC_AI_MODELS = [
	{ id: 'claude-sonnet-5', label: () => 'Sonnet 5' },
	{ id: 'claude-opus-5', label: () => 'Opus 5' },
] as const satisfies readonly AiModel[];

export const anthropicDescriptor: ProviderDescriptor< AnthropicConfig > = {
	id: 'anthropic',
	label: 'Anthropic API',
	configSchema: anthropicConfigSchema,
	account: { methods: [ 'api-key' ] },
	ai: {
		models: ANTHROPIC_AI_MODELS,
		defaultModel: 'claude-sonnet-5',
	},
};
