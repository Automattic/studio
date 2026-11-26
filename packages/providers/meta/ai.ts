import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { metaCatalog } from './catalog';
import { generateMetaImages } from './images';
import type { MetaConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

export const metaAi: NonNullable< ProviderServices< MetaConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect Meta with an API key.' );
		}
		const model = metaCatalog.run( modelId );
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
			model,
		};
	},
	listModels: metaCatalog.listModels,
	selectModels: metaCatalog.selectModels,
	generateImages: generateMetaImages,
};
