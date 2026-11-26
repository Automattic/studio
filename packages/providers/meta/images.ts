import { NotConnectedError } from '../errors';
import {
	generateImagesOn,
	interpretImageResponse,
	resolveImageSize,
	type ImageDialect,
} from '../wpcom/ai/images';
import type { MetaConfig } from './config';
import type { ProviderServices } from '../types';

const IMAGE_MODEL = 'muse-image-1.0';

// Meta's images route follows OpenAI's but rejects unknown fields such as
// `quality`. Its web and image search would ground site images in real brands
// and places, and slows every render.
export const metaImageDialect: ImageDialect = {
	body: ( request, model ) => ( {
		model,
		prompt: request.prompt,
		size: resolveImageSize( request.aspectRatio ),
		output_format: 'webp',
		reasoning_strength: 'low',
		tool_enablement: {
			enable_image_search: false,
			enable_web_search: false,
			enable_shell: false,
		},
	} ),
	read: interpretImageResponse,
};

export const generateMetaImages: NonNullable<
	NonNullable< ProviderServices< MetaConfig >[ 'ai' ] >[ 'generateImages' ]
> = async ( config, requests, onResult ) => {
	if ( ! config ) {
		throw new NotConnectedError( 'Generating images with Meta needs an API key.' );
	}
	const route = {
		url: 'https://api.meta.ai/v1/images/generations',
		headers: { authorization: `Bearer ${ config.apiKey }` },
		model: IMAGE_MODEL,
		dialect: metaImageDialect,
	};
	return generateImagesOn( route, requests, onResult );
};
