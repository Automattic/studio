import {
	FILTERED_ERROR_CODES,
	generateEach,
	ImageFilteredError,
	resolveImageSize,
	TransientImageError,
} from '../images';
import { getAiGatewayBaseUrl } from './ai';
import type { WpcomConfig } from './config';
import type { GenerateImageRequest, GenerateImages } from '../types';

// Image generation through the proxy's OpenAI-compatible images route, which
// only delivers PNG.

// The proxy picks the actual model behind the `image` alias; a real model id
// is rejected.
const IMAGE_MODEL_ALIAS = 'image';
// The proxy accepts only `low` or `medium`.
const IMAGE_QUALITY = 'medium';
// Studio's image slug on the proxy; it accepts regular user OAuth tokens.
const IMAGE_FEATURE_SLUG = 'studio-image';
const MAX_CONCURRENT_REQUESTS = 5;

export function buildImageRequestBody(
	prompt: string,
	aspectRatioKeyword: string | undefined
): Record< string, unknown > {
	// No `stream` and no `n` above 1: the proxy rejects both.
	return {
		model: IMAGE_MODEL_ALIAS,
		prompt,
		quality: IMAGE_QUALITY,
		size: resolveImageSize( aspectRatioKeyword ),
	};
}

interface ImagesResponse {
	data?: Array< { b64_json?: string } >;
	error?: { code?: string; message?: string };
}

function parseJson( raw: string ): ImagesResponse | null {
	try {
		return JSON.parse( raw ) as ImagesResponse;
	} catch {
		return null;
	}
}

const PNG_SIGNATURE = new Uint8Array( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] );

/**
 * Interpret a completed transfer: HTTP-status classification plus images
 * response parsing. Returns decoded PNG bytes or throws TransientImageError
 * (429/5xx — retryable), ImageFilteredError (moderation — retryable, and
 * repairable by rewriting the subject), or Error (permanent).
 */
export function interpretImageResponse( raw: string, status: number ): Uint8Array {
	if ( status === 429 || status >= 500 ) {
		throw new TransientImageError( `HTTP ${ status }: ${ raw.slice( 0, 300 ) }` );
	}
	const data = parseJson( raw );
	const errorCode = data?.error?.code;
	if ( errorCode && FILTERED_ERROR_CODES.has( errorCode ) ) {
		throw new ImageFilteredError(
			`Image safety filter rejected the prompt: ${ data?.error?.message ?? errorCode }`
		);
	}
	if ( status < 200 || status >= 300 ) {
		throw new Error( `Image proxy HTTP ${ status }: ${ raw.slice( 0, 500 ) }` );
	}
	if ( ! data ) {
		throw new Error( `Image proxy returned non-JSON response: ${ raw.slice( 0, 300 ) }` );
	}

	const base64 = data.data?.[ 0 ]?.b64_json;
	if ( ! base64 ) {
		throw new Error( `Image proxy response had no image data: ${ raw.slice( 0, 300 ) }` );
	}

	const bytes = Uint8Array.from( atob( base64 ), ( char ) => char.charCodeAt( 0 ) );
	// Byte magic is the source of truth: never deliver non-PNG bytes under a
	// .png filename.
	if ( ! PNG_SIGNATURE.every( ( byte, index ) => bytes[ index ] === byte ) ) {
		throw new Error( 'Image proxy returned bytes that are not a PNG' );
	}
	return bytes;
}

async function generateOne(
	endpoint: string,
	token: string,
	request: GenerateImageRequest
): Promise< Uint8Array > {
	const response = await fetch( endpoint, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${ token }`,
			'x-wpcom-ai-feature': IMAGE_FEATURE_SLUG,
			'content-type': 'application/json',
		},
		body: JSON.stringify( buildImageRequestBody( request.prompt, request.aspectRatio ) ),
	} );
	return interpretImageResponse( await response.text(), response.status );
}

export const generateWpcomImages: GenerateImages< WpcomConfig > = async (
	config,
	requests,
	onResult
) => {
	if ( ! config ) {
		throw new Error( 'Image generation requires a WordPress.com login (studio auth login).' );
	}
	const endpoint = `${ getAiGatewayBaseUrl() }/v1/images/generations`;
	return generateEach(
		requests,
		MAX_CONCURRENT_REQUESTS,
		( request ) => generateOne( endpoint, config.token, request ),
		onResult
	);
};
