import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { anthropicConfigSchema, type AnthropicConfig } from './config';
import type { AiModel, ProviderDescriptor } from '../types';

export const ANTHROPIC_AI_MODELS = [
	{ id: 'claude-sonnet-5-5', label: () => 'Sonnet 5.5' },
	{ id: 'claude-opus-5-5', label: () => 'Opus 5.5' },
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

const SETUP_TOKEN_PREFIX = 'sk-ant-oat01-';

export const anthropicSetupTokenInput = () =>
	z.object( {
		token: z
			.string()
			.trim()
			.min( 1, __( 'Token is required' ) )
			.startsWith(
				SETUP_TOKEN_PREFIX,
				__( 'Enter a token from claude setup-token, not an API key.' )
			)
			.meta( {
				title: __( 'Claude subscription token' ),
				description: __(
					'Run claude setup-token in a terminal and paste the token it prints. Usage counts against your Claude plan.'
				),
				examples: [ `${ SETUP_TOKEN_PREFIX }…` ],
				writeOnly: true,
			} ),
	} );

export const anthropicDescriptor: ProviderDescriptor< AnthropicConfig > = {
	id: 'anthropic',
	label: 'Anthropic',
	description: () => __( 'Use Claude with your own API key or Claude subscription.' ),
	learnMoreUrl: 'https://platform.claude.com/docs/en/get-api-key',
	configSchema: anthropicConfigSchema,
	connection: [
		{ id: 'api-key', label: () => __( 'API key' ), kind: 'form', input: anthropicConnectInput },
		{
			id: 'setup-token',
			label: () => __( 'Claude subscription' ),
			kind: 'form',
			input: anthropicSetupTokenInput,
		},
	],
	summarize: ( config ) =>
		previewApiKey( config.method === 'api-key' ? config.apiKey : config.token ),
	ai: {
		models: ANTHROPIC_AI_MODELS,
		defaultModel: 'claude-sonnet-5-5',
	},
};
