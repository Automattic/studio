import { NotConnectedError } from '../errors';
import {
	decodePng,
	generateImagesOn,
	ImageFilteredError,
	TransientImageError,
	type ImageDialect,
} from '../wpcom/ai/images';
import { OPENROUTER_API_URL, OPENROUTER_HEADERS } from './api';
import type { OpenrouterConfig } from './config';
import type { ProviderServices } from '../types';

// Nano Banana 2, the model the Gemini provider draws with, answers in PNG.
const IMAGE_MODEL = 'google/gemini-3.1-flash-image';

const ASPECT_RATIOS: Record< string, string > = {
	square: '1:1',
	landscape: '16:9',
	ultrawide: '21:9',
	portrait: '9:16',
	'card-landscape': '4:3',
	'card-portrait': '3:4',
};
const DEFAULT_ASPECT_RATIO = '16:9';

// Gemini's safety verdicts, which OpenRouter passes through; rewriting the
// subject can get the next attempt through.
const FILTERED_REASONS = new Set( [
	'content_filter',
	'SAFETY',
	'IMAGE_SAFETY',
	'PROHIBITED_CONTENT',
	'BLOCKLIST',
	'IMAGE_PROHIBITED_CONTENT',
] );

interface ChatResponse {
	choices?: {
		finish_reason?: string;
		native_finish_reason?: string;
		message?: { content?: string | null; images?: { image_url?: { url?: string } }[] };
	}[];
	error?: { message?: string };
}

function parseJson( raw: string ): ChatResponse | null {
	try {
		return JSON.parse( raw ) as ChatResponse;
	} catch {
		return null;
	}
}

// OpenRouter draws through its chat completions route, answering with the
// image as a data URL.
export const openrouterImageDialect: ImageDialect = {
	body: ( request, model ) => ( {
		model,
		messages: [ { role: 'user', content: request.prompt } ],
		modalities: [ 'image', 'text' ],
		image_config: {
			aspect_ratio: ASPECT_RATIOS[ request.aspectRatio ?? '' ] ?? DEFAULT_ASPECT_RATIO,
		},
	} ),

	read: ( raw, status ) => {
		if ( status === 429 || status >= 500 ) {
			throw new TransientImageError( `HTTP ${ status }: ${ raw.slice( 0, 300 ) }` );
		}
		const data = parseJson( raw );
		if ( status < 200 || status >= 300 ) {
			throw new Error(
				`OpenRouter HTTP ${ status }: ${ data?.error?.message ?? raw.slice( 0, 500 ) }`
			);
		}
		const choice = data?.choices?.[ 0 ];
		const url = choice?.message?.images?.find( ( image ) => image.image_url?.url )?.image_url?.url;
		const match = url?.match( /^data:([^;]+);base64,(.+)$/ );
		if ( ! match ) {
			const reason = choice?.native_finish_reason ?? choice?.finish_reason;
			if ( reason && FILTERED_REASONS.has( reason ) ) {
				throw new ImageFilteredError(
					`OpenRouter’s safety filter rejected the prompt: ${ reason }`
				);
			}
			throw new Error(
				`OpenRouter returned no image: ${ choice?.message?.content ?? raw.slice( 0, 300 ) }`
			);
		}
		return decodePng( match[ 2 ], `OpenRouter (${ match[ 1 ] })` );
	},
};

export const generateOpenrouterImages: NonNullable<
	NonNullable< ProviderServices< OpenrouterConfig >[ 'ai' ] >[ 'generateImages' ]
> = async ( config, requests, onResult ) => {
	if ( ! config ) {
		throw new NotConnectedError( 'Generating images with OpenRouter needs an API key.' );
	}
	const route = {
		url: `${ OPENROUTER_API_URL }/chat/completions`,
		headers: { authorization: `Bearer ${ config.apiKey }`, ...OPENROUTER_HEADERS },
		model: IMAGE_MODEL,
		dialect: openrouterImageDialect,
	};
	return generateImagesOn( route, requests, onResult );
};
