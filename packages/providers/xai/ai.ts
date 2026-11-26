import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { xaiCatalog } from './catalog';
import { generateXaiImages } from './images';
import type { XaiConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

// Errors by HTTP status, said for the user.
const getErrors = ( method: XaiConfig[ 'method' ] ): Record< number, string > =>
	method === 'grok'
		? {
				401: __( 'Your Grok sign-in no longer works. Connect xAI again in Settings.' ),
				402: __(
					'This Grok account has no credits left. Add credits or get SuperGrok on grok.com.'
				),
				403: __( 'Your Grok or X plan can’t be used in WordPress Studio.' ),
				429: __( 'You reached your Grok plan’s usage limit. Check your usage on grok.com.' ),
		  }
		: {
				400: __( 'xAI rejected the API key. Connect xAI again in Settings.' ),
				401: __( 'xAI rejected the API key. Connect xAI again in Settings.' ),
				402: __( 'This xAI account has no credits left. Add credits in the xAI Console.' ),
				403: __( 'xAI refused the API key. Check its permissions and credits in the xAI Console.' ),
		  };

export const xaiAi: NonNullable< ProviderServices< XaiConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect xAI with a Grok plan or an API key.' );
		}
		const model = xaiCatalog.run( modelId );
		if ( ! model ) {
			throw new Error( `xAI does not serve ${ modelId }` );
		}
		return {
			piProvider: 'xai',
			apiKey: config.method === 'grok' ? config.accessToken : config.apiKey,
			rewriteError: ( message ) => {
				const status = message.match( /^xai API error \((\d+)\)/ )?.[ 1 ];
				return status ? getErrors( config.method )[ Number( status ) ] : undefined;
			},
			model,
		};
	},
	listModels: xaiCatalog.listModels,
	selectModels: xaiCatalog.selectModels,
	generateImages: generateXaiImages,
};
