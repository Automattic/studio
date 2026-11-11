import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { customConfigSchema, type CustomConfig } from './config';
import type { AiModel, ProviderDescriptor } from '../types';

// The connected endpoint's model, whose name the connection holds. Another of
// the endpoint's models is a new connection.
export const CUSTOM_AI_MODELS = [
	{ id: 'custom', label: () => __( 'Custom endpoint model' ) },
] as const satisfies readonly AiModel[];

export const customConnectInput = () =>
	z.object( {
		url: z
			.string()
			.trim()
			.refine( ( value ) => URL.canParse( value ), __( 'Enter a full URL.' ) )
			.meta( {
				title: __( 'Endpoint URL' ),
				description: __( 'An OpenAI Chat Completions or Anthropic Messages API.' ),
				examples: [ 'https://openrouter.ai/api/v1' ],
			} ),
		apiKey: z
			.string()
			.trim()
			.min( 1, __( 'API key is required' ) )
			.meta( { title: __( 'API key' ), writeOnly: true } ),
		model: z
			.string()
			.trim()
			.min( 1, __( 'Name the model.' ) )
			.meta( {
				title: __( 'Model name' ),
				description: __( 'The name the endpoint gives the model.' ),
				examples: [ 'z-ai/glm-4.6' ],
			} ),
		images: z
			.string()
			.trim()
			.toLowerCase()
			.refine( ( value ) => value === 'yes' || value === 'no', __( 'Answer yes or no.' ) )
			.meta( {
				title: __( 'Does the model take images (yes or no)' ),
				description: __( 'Screenshots reach a model that takes images.' ),
				examples: [ 'yes' ],
			} ),
	} );

export const customDescriptor: ProviderDescriptor< CustomConfig > = {
	id: 'custom',
	label: 'Custom endpoint',
	description: () => __( 'Use a model from an endpoint of your own.' ),
	configSchema: customConfigSchema,
	connection: { kind: 'form', input: customConnectInput },
	summarize: ( config ) => `${ config.model } at ${ new URL( config.baseUrl ).host }`,
	ai: {
		models: CUSTOM_AI_MODELS,
		defaultModel: 'custom',
	},
};
