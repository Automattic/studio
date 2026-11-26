import { NotConnectedError } from '../errors';
import {
	decodeImage,
	generateImagesOn,
	TransientImageError,
	type ImageDialect,
} from '../wpcom/ai/images';
import type { XaiConfig } from './config';
import type { ProviderServices } from '../types';

const IMAGE_MODEL = 'grok-imagine-image-2.0';

// Grok Imagine takes the canvas as a ratio, so each slot shape asks for its own
// rather than the nearest of three pixel sizes.
const ASPECT_RATIOS: Record< string, string > = {
	square: '1:1',
	landscape: '16:9',
	ultrawide: '21:9',
	portrait: '9:16',
	'card-landscape': '4:3',
	'card-portrait': '3:4',
};
const DEFAULT_ASPECT_RATIO = '16:9';

interface ImagesResponse {
	data?: { b64_json?: string; mime_type?: string }[];
	error?: { code?: string; message?: string };
}

function parseJson( raw: string ): ImagesResponse | null {
	try {
		return JSON.parse( raw ) as ImagesResponse;
	} catch {
		return null;
	}
}

export const xaiImageDialect: ImageDialect = {
	body: ( request, model ) => ( {
		model,
		prompt: request.prompt,
		aspect_ratio: ASPECT_RATIOS[ request.aspectRatio ?? '' ] ?? DEFAULT_ASPECT_RATIO,
		// Grok Imagine renders 2k as a PNG and 1k as a JPEG.
		resolution: '2k',
		response_format: 'b64_json',
	} ),

	read: ( raw, status ) => {
		if ( status === 429 || status >= 500 ) {
			throw new TransientImageError( `HTTP ${ status }: ${ raw.slice( 0, 300 ) }` );
		}
		const data = parseJson( raw );
		if ( status < 200 || status >= 300 ) {
			throw new Error( `xAI HTTP ${ status }: ${ data?.error?.message ?? raw.slice( 0, 500 ) }` );
		}
		const image = data?.data?.[ 0 ];
		if ( ! image?.b64_json ) {
			throw new Error( `xAI returned no image: ${ raw.slice( 0, 300 ) }` );
		}
		return decodeImage( image.b64_json, `xAI (${ image.mime_type ?? 'unknown type' })` );
	},
};

export const generateXaiImages: NonNullable<
	NonNullable< ProviderServices< XaiConfig >[ 'ai' ] >[ 'generateImages' ]
> = async ( config, requests, onResult ) => {
	if ( ! config ) {
		throw new NotConnectedError( 'Generating images with xAI needs a Grok plan or an API key.' );
	}
	const route = {
		url: 'https://api.x.ai/v1/images/generations',
		headers: {
			authorization: `Bearer ${ config.method === 'grok' ? config.accessToken : config.apiKey }`,
		},
		model: IMAGE_MODEL,
		dialect: xaiImageDialect,
	};
	return generateImagesOn( route, requests, onResult );
};
