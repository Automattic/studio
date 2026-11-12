import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { anthropicConfigSchema, type AnthropicConfig } from './config';
import type { AiModel, ProviderDescriptor } from '../types';

export const ANTHROPIC_AI_MODELS = [
	{
		id: 'claude-sonnet-5-5',
		label: () => 'Sonnet 5.5',
		description: () => __( 'Build features, style pages, and fix bugs' ),
	},
	{
		id: 'claude-opus-5-5',
		label: () => 'Opus 5.5',
		description: () => __( 'Plan complex builds and solve harder problems' ),
	},
] as const satisfies readonly AiModel[];

const KEY_PREFIX_LENGTH = 16;
const KEY_SUFFIX_LENGTH = 4;

// Enough to recognise the key, never enough to use it; a short key shows
// only its tail so most of it is not echoed back.
function previewApiKey( key: string ): string {
	if ( key.length <= KEY_PREFIX_LENGTH + KEY_SUFFIX_LENGTH ) {
		return `...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
	}
	return `${ key.slice( 0, KEY_PREFIX_LENGTH ) }...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
}

export const anthropicConnectInput = () =>
	z.object( {
		apiKey: z
			.string()
			.trim()
			.min( 1, __( 'API key is required' ) )
			.meta( {
				title: __( 'Anthropic API key' ),
				description: __( 'Usage is billed through your Anthropic account.' ),
				examples: [ 'sk-…' ],
				writeOnly: true,
			} ),
	} );

export const anthropicDescriptor: ProviderDescriptor< AnthropicConfig > = {
	id: 'anthropic',
	label: 'Anthropic API',
	description: () => __( 'Use Claude with your own API key.' ),
	learnMoreUrl: 'https://platform.claude.com/docs/en/get-api-key',
	configSchema: anthropicConfigSchema,
	connection: { kind: 'form', input: anthropicConnectInput },
	summarize: ( config ) => previewApiKey( config.apiKey ),
	ai: {
		brand: 'Claude',
		models: ANTHROPIC_AI_MODELS,
		defaultModel: 'claude-sonnet-5-5',
	},
};
