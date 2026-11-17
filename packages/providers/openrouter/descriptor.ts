import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { previewApiKey } from '../api-key';
import { openrouterConfigSchema, type OpenrouterConfig } from './config';
import type { AiModel, Provider } from '../types';

// Models that run Studio Code's tools well, out of the hundreds OpenRouter
// routes to. Ids other providers serve are shared with them.
export const OPENROUTER_AI_MODELS = [
	{ id: 'claude-sonnet-5-5', label: () => 'Sonnet 5.5' },
	{ id: 'claude-opus-5-5', label: () => 'Opus 5.5' },
	{ id: 'gpt-6.1-terra', label: () => 'GPT-6.1 Terra' },
	{ id: 'gemini-4-argon', label: () => 'Gemini 4 Argon' },
	{ id: 'grok-4.7', label: () => 'Grok 4.7' },
	{ id: 'deepseek-v4.1-flash', label: () => 'DeepSeek V4.1 Flash' },
	{ id: 'kimi-k3', label: () => 'Kimi K3' },
] as const satisfies readonly AiModel[];

export const openrouterConnectInput = () =>
	z.object( {
		apiKey: z
			.string()
			.trim()
			.min( 1, __( 'API key is required' ) )
			.meta( {
				title: __( 'OpenRouter API key' ),
				description: __( 'Usage is paid with your OpenRouter credits.' ),
				examples: [ 'sk-or-v1-…' ],
				writeOnly: true,
			} ),
	} );

// https://openrouter.ai/brand/v2/openrouter-glyph-dark.svg
const mark =
	'<path d="M303.9,17.2c42.8,0,77.5,34.7,77.5,77.5s-34.7,77.5-77.5,77.5l76.9,76.9c9.8,9.8,2.8,26.5-11,26.5h-220.9c-71.3,0-129.1-57.8-129.1-129.1S77.6,17.2,149,17.2h155ZM149,68.9c-42.8,0-77.5,34.7-77.5,77.5s34.7,77.5,77.5,77.5,77.5-34.7,77.5-77.5-34.7-77.5-77.5-77.5Z"/>';

export const openrouterProvider: Provider< OpenrouterConfig > = {
	id: 'openrouter',
	label: 'OpenRouter',
	description: () => __( 'Use models from many labs with your OpenRouter credits.' ),
	learnMoreUrl: 'https://openrouter.ai/docs/quickstart',
	icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="12.6 -43.6 380 380" fill="currentColor">${ mark }</svg>`,
	logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-97.4 -153.6 600 600"><rect x="-97.4" y="-153.6" width="600" height="600" fill="#03080A"/><g fill="#C8FF00">${ mark }</g></svg>`,
	account: {
		configSchema: openrouterConfigSchema,
		methods: [
			{ id: 'sign-in', label: () => __( 'Sign in with OpenRouter' ), kind: 'loopback' },
			{
				id: 'api-key',
				label: () => __( 'API key' ),
				kind: 'form',
				input: openrouterConnectInput,
				instructions: () =>
					__(
						'Create a key in your [OpenRouter settings](https://openrouter.ai/settings/keys), then paste it below.'
					),
			},
		],
		describe: ( config ) => ( {
			method: config.method,
			summary: previewApiKey( config.apiKey ),
			links: [ { label: __( 'Manage credits' ), url: 'https://openrouter.ai/settings/credits' } ],
		} ),
	},
	ai: {
		models: OPENROUTER_AI_MODELS,
		defaultModel: 'claude-sonnet-5-5',
	},
};
