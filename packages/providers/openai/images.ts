import { NotConnectedError } from '../errors';
import { generateImagesOn } from '../wpcom/ai/images';
import type { OpenaiConfig } from './config';
import type { ProviderServices } from '../types';

export const generateOpenaiImages: NonNullable<
	NonNullable< ProviderServices< OpenaiConfig >[ 'ai' ] >[ 'generateImages' ]
> = async ( config, requests, onResult ) => {
	if ( config?.method !== 'api-key' ) {
		throw new NotConnectedError( 'Generating images with OpenAI needs an API key.' );
	}
	const route = {
		url: 'https://api.openai.com/v1/images/generations',
		headers: { authorization: `Bearer ${ config.apiKey }` },
		model: 'gpt-image-2',
	};
	return generateImagesOn( route, requests, onResult );
};
