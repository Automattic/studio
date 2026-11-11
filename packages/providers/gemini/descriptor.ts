import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { geminiConfigSchema, type GeminiConfig } from './config';
import type { AiModel, ProviderDescriptor } from '../types';

export const GEMINI_AI_MODELS = [
	{ id: 'gemini-3.8-flash', label: () => 'Gemini 3.8 Flash' },
	{ id: 'gemini-4-argon', label: () => 'Gemini 4 Argon' },
	{ id: 'gemini-4-carbon', label: () => 'Gemini 4 Carbon' },
] as const satisfies readonly AiModel[];

export const geminiConnectInput = () =>
	z.object( {
		apiKey: z
			.string()
			.trim()
			.min( 1, __( 'API key is required' ) )
			.meta( {
				title: __( 'Gemini API key' ),
				description: __( 'Usage is billed through your Google AI Studio account.' ),
				writeOnly: true,
			} ),
	} );

export const geminiDescriptor: ProviderDescriptor< GeminiConfig > = {
	id: 'gemini',
	label: 'Google Gemini',
	description: () => __( 'Use Gemini with your own API key.' ),
	learnMoreUrl: 'https://aistudio.google.com/apikey',
	configSchema: geminiConfigSchema,
	connection: { kind: 'form', input: geminiConnectInput },
	summarize: ( { apiKey } ) => ( apiKey.length > 4 ? `...${ apiKey.slice( -4 ) }` : '...' ),
	ai: {
		models: GEMINI_AI_MODELS,
		defaultModel: 'gemini-3.8-flash',
	},
};
