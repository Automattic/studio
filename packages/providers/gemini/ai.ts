import { NotConnectedError } from '../errors';
import { geminiCatalog } from './catalog';
import { generateGeminiImages } from './images';
import type { GeminiConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

export const geminiAi: NonNullable< ProviderServices< GeminiConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect Google Gemini with an API key.' );
		}
		const model = geminiCatalog.run( modelId );
		if ( ! model ) {
			throw new Error( `Google Gemini does not serve ${ modelId }` );
		}
		return {
			piProvider: 'google',
			apiKey: config.apiKey,
			model,
		};
	},
	listModels: geminiCatalog.listModels,
	selectModels: geminiCatalog.selectModels,
	generateImages: generateGeminiImages,
};
