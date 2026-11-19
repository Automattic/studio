import { NotConnectedError } from '../errors';
import {
	decodePng,
	generateImagesOn,
	ImageFilteredError,
	TransientImageError,
	type ImageDialect,
} from '../wpcom/ai/images';
import type { GeminiConfig } from './config';
import type { ProviderServices } from '../types';

// Gemini's image models answer `generateContent` with the image inline. The
// OpenAI-compatible images route only serves the retired Imagen models.
const IMAGE_MODEL = 'gemini-3.1-flash-image';

// The canvas each layout slot asks for, among the ratios Gemini renders.
const ASPECT_RATIOS: Record< string, string > = {
	square: '1:1',
	landscape: '16:9',
	ultrawide: '21:9',
	portrait: '9:16',
	'card-landscape': '4:3',
	'card-portrait': '3:4',
};
const DEFAULT_ASPECT_RATIO = '16:9';

// Verdicts the model reports instead of an image; the filter is
// non-deterministic, and rewriting the subject can get the next attempt through.
const FILTERED_REASONS = new Set( [
	'SAFETY',
	'IMAGE_SAFETY',
	'PROHIBITED_CONTENT',
	'BLOCKLIST',
	'IMAGE_PROHIBITED_CONTENT',
] );

interface GenerateContentResponse {
	candidates?: {
		finishReason?: string;
		content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
	}[];
	promptFeedback?: { blockReason?: string };
	error?: { status?: string; message?: string };
}

function parseJson( raw: string ): GenerateContentResponse | null {
	try {
		return JSON.parse( raw ) as GenerateContentResponse;
	} catch {
		return null;
	}
}

export const geminiImageDialect: ImageDialect = {
	body: ( request ) => ( {
		contents: [ { parts: [ { text: request.prompt } ] } ],
		generationConfig: {
			responseModalities: [ 'IMAGE' ],
			imageConfig: {
				aspectRatio: ASPECT_RATIOS[ request.aspectRatio ?? '' ] ?? DEFAULT_ASPECT_RATIO,
			},
		},
	} ),

	read: ( raw, status ) => {
		if ( status === 429 || status >= 500 ) {
			throw new TransientImageError( `HTTP ${ status }: ${ raw.slice( 0, 300 ) }` );
		}
		const data = parseJson( raw );
		const candidate = data?.candidates?.[ 0 ];
		const blocked = data?.promptFeedback?.blockReason ?? candidate?.finishReason;
		if ( blocked && FILTERED_REASONS.has( blocked ) ) {
			throw new ImageFilteredError( `Gemini’s safety filter rejected the prompt: ${ blocked }` );
		}
		if ( status < 200 || status >= 300 ) {
			throw new Error(
				`Gemini HTTP ${ status }: ${ data?.error?.message ?? raw.slice( 0, 500 ) }`
			);
		}
		if ( ! data ) {
			throw new Error( `Gemini returned a non-JSON response: ${ raw.slice( 0, 300 ) }` );
		}
		const image = candidate?.content?.parts?.find( ( part ) => part.inlineData?.data )?.inlineData;
		if ( ! image?.data ) {
			// A model that answers in words says why it drew nothing.
			const text = candidate?.content?.parts?.find( ( part ) => part.text )?.text;
			throw new Error( `Gemini returned no image: ${ text ?? raw.slice( 0, 300 ) }` );
		}
		return decodePng( image.data, `Gemini (${ image.mimeType ?? 'unknown type' })` );
	},
};

export const generateGeminiImages: NonNullable<
	NonNullable< ProviderServices< GeminiConfig >[ 'ai' ] >[ 'generateImages' ]
> = async ( config, requests, onResult ) => {
	if ( ! config ) {
		throw new NotConnectedError( 'Generating images with Gemini needs an API key.' );
	}
	const route = {
		url: `https://generativelanguage.googleapis.com/v1beta/models/${ IMAGE_MODEL }:generateContent`,
		headers: { 'x-goog-api-key': config.apiKey },
		model: IMAGE_MODEL,
		dialect: geminiImageDialect,
	};
	return generateImagesOn( route, requests, onResult );
};
