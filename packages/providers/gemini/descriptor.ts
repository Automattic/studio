import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { geminiConfigSchema, type GeminiConfig } from './config';
import type { AiModel, Provider } from '../types';

export const GEMINI_AI_MODELS = [
	{ id: 'gemini-3.8-flash', label: () => 'Gemini 3.8 Flash' },
	{ id: 'gemini-4-argon', label: () => 'Gemini 4 Argon' },
] as const satisfies readonly AiModel[];

export const geminiConnectInput = () =>
	z.object( {
		apiKey: z
			.string()
			.trim()
			.min( 1, __( 'API key is required' ) )
			.meta( {
				title: __( 'Gemini API key' ),
				description: __( 'Usage is billed through your Google AI Studio project.' ),
				examples: [ 'AIza…' ],
				writeOnly: true,
			} ),
	} );

export const geminiProvider: Provider< GeminiConfig > = {
	id: 'gemini',
	label: 'Google Gemini',
	description: () => __( 'Use Gemini with your own API key.' ),
	learnMoreUrl: 'https://aistudio.google.com/apikey',
	// https://github.com/simple-icons/simple-icons/blob/develop/icons/googlegemini.svg
	icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>',
	account: {
		configSchema: geminiConfigSchema,
		methods: [
			{ id: 'api-key', label: () => __( 'API key' ), kind: 'form', input: geminiConnectInput },
		],
		describe: ( { apiKey } ) => ( { method: 'api-key', summary: `...${ apiKey.slice( -4 ) }` } ),
	},
	ai: {
		models: GEMINI_AI_MODELS,
		defaultModel: 'gemini-3.8-flash',
	},
};
