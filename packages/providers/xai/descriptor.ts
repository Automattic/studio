import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { previewApiKey } from '../api-key';
import { xaiConfigSchema, type XaiConfig } from './config';
import type { AiModel, Provider } from '../types';

export const XAI_AI_MODELS = [
	{ id: 'grok-4.7', label: () => 'Grok 4.7' },
	{ id: 'grok-4.3', label: () => 'Grok 4.3' },
] as const satisfies readonly AiModel[];

export const xaiConnectInput = () =>
	z.object( {
		apiKey: z
			.string()
			.trim()
			.min( 1, __( 'API key is required' ) )
			.meta( {
				title: __( 'xAI API key' ),
				description: __( 'Usage is billed through your xAI account.' ),
				examples: [ 'xai-…' ],
				writeOnly: true,
			} ),
	} );

// https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/xai.svg
const mark =
	'<path fill-rule="evenodd" d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"/>';

export const xaiProvider: Provider< XaiConfig > = {
	id: 'xai',
	label: 'xAI',
	description: () => __( 'Use Grok with your SuperGrok or X Premium plan, or an API key.' ),
	learnMoreUrl: 'https://docs.x.ai/docs/overview',
	icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${ mark }</svg>`,
	logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 36 36"><rect x="-6" y="-6" width="36" height="36" fill="#000"/><g fill="#FFF">${ mark }</g></svg>`,
	account: {
		configSchema: xaiConfigSchema,
		methods: [
			{ id: 'grok', label: () => __( 'SuperGrok or X Premium' ), kind: 'device' },
			{
				id: 'api-key',
				label: () => __( 'API key' ),
				kind: 'form',
				input: xaiConnectInput,
				instructions: () =>
					__( 'Create a key in the [xAI Console](https://console.x.ai), then paste it below.' ),
			},
		],
		describe: ( config ) =>
			config.method === 'api-key'
				? { method: config.method, summary: previewApiKey( config.apiKey ) }
				: {
						method: config.method,
						note: __( 'Using Grok plan' ),
						links: [ { label: __( 'Manage usage' ), url: 'https://grok.com' } ],
				  },
	},
	ai: {
		models: XAI_AI_MODELS,
		defaultModel: 'grok-4.7',
	},
};
