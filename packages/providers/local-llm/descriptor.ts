import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { localLlmConfigSchema, type LocalLlmConfig } from './config';
import type { Provider } from '../types';

export const localLlmConnectInput = () =>
	z.object( {
		address: z
			.string()
			.trim()
			.min( 1, __( 'Address is required' ) )
			.meta( {
				title: __( 'Server address' ),
				description: __( 'Where your server listens, as it prints it when it starts.' ),
				examples: [ 'http://localhost:11434' ],
			} ),
		apiKey: z
			.string()
			.trim()
			.default( '' )
			.meta( {
				title: __( 'API key' ),
				description: __( 'Only if your server asks for one.' ),
				writeOnly: true,
			} ),
	} );

export const LOCAL_LLM_MODEL_PREFIX = 'local-llm/';

// The address the user knows the server by: its API without the `/v1` path.
export function getServerAddress( baseUrl: string ): string {
	return baseUrl.replace( /\/v1$/, '' );
}

// A server rack, drawn in `currentColor`.
const mark =
	'<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>';

export const localLlmProvider: Provider< LocalLlmConfig > = {
	id: 'local-llm',
	label: 'Local LLM',
	description: () => __( 'Use the models a server you run serves, such as on this computer.' ),
	icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ mark }</svg>`,
	logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 36 36"><rect x="-6" y="-6" width="36" height="36" fill="#1E1E1E"/><g fill="none" stroke="#FFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ mark }</g></svg>`,
	account: {
		configSchema: localLlmConfigSchema,
		methods: [
			{
				id: 'server',
				label: () => __( 'Server address' ),
				kind: 'form',
				input: localLlmConnectInput,
				// The server is on the user's computer or network, which Studio running elsewhere can't reach.
				hostOnly: true,
				instructions: () =>
					__(
						'Start your model server with at least one model, then enter the address it listens on. Studio offers the models it serves.'
					),
			},
		],
		describe: ( config ) => ( {
			method: config.method,
			summary: getServerAddress( config.baseUrl ),
			models: config.models.map( ( model ) => ( {
				id: `${ LOCAL_LLM_MODEL_PREFIX }${ model.name }` as const,
				label: model.name,
				supportsImages: model.images,
			} ) ),
		} ),
	},
	// The models are the server's: an account always offers the ones it picked, so the default,
	// which no server lists, never starts a chat.
	ai: {
		models: [],
		defaultModel: LOCAL_LLM_MODEL_PREFIX,
		catalog: { prefixes: [ LOCAL_LLM_MODEL_PREFIX ] },
		local: true,
	},
};
