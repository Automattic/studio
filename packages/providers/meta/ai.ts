import { META_MODELS } from '@earendil-works/pi-ai/providers/meta.models';
import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { META_AI_MODELS } from './descriptor';
import type { MetaConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

export const metaAi: NonNullable< ProviderServices< MetaConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect Meta with an API key.' );
		}
		const model =
			META_AI_MODELS.some( ( { id } ) => id === modelId ) &&
			META_MODELS[ modelId as keyof typeof META_MODELS ];
		if ( ! model ) {
			throw new Error( `Meta does not serve ${ modelId }` );
		}
		return {
			piProvider: 'meta',
			apiKey: config.apiKey,
			rewriteError: ( message ) =>
				/^429\b/.test( message )
					? __(
							'Meta is limiting requests on your API key. Try again shortly, or check your limits at dev.meta.ai.'
					  )
					: undefined,
			model: {
				...model,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		};
	},
};
