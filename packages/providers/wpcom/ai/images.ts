import { getAiGatewayBaseUrl } from './gateway';
import type { GenerateImageRequest, GenerateImageResult, ProviderServices } from '../../types';
import type { WpcomConfig } from '../config';

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
const RETRY_DELAYS_SECONDS = [ 2, 5, 12 ];

// The route renders only these three canvases, so each slot shape maps to the
// nearest one and CSS crops to the slot.
const IMAGE_SIZE_BY_ASPECT_RATIO: Record< string, string > = {
	square: '1024x1024',
	landscape: '1536x1024',
	ultrawide: '1536x1024',
	portrait: '1024x1536',
	'card-landscape': '1536x1024',
	'card-portrait': '1024x1536',
};
// Error codes the proxy passes through when the moderation system rejected the
// prompt; any other failure must not be reported as repairable-by-rewriting.
const FILTERED_ERROR_CODES = new Set( [ 'moderation_blocked', 'content_policy_violation' ] );

export function resolveImageSize( aspectRatio: string | undefined ): string {
	return IMAGE_SIZE_BY_ASPECT_RATIO[ aspectRatio ?? 'landscape' ] ?? '1536x1024';
}

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

export class TransientImageError extends Error {}
export class ImageFilteredError extends Error {}

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

const sleep = ( seconds: number ) =>
	new Promise< void >( ( resolve ) => setTimeout( resolve, seconds * 1000 ) );

async function generateOne(
	endpoint: string,
	token: string,
	request: GenerateImageRequest
): Promise< GenerateImageResult > {
	const body = JSON.stringify( buildImageRequestBody( request.prompt, request.aspectRatio ) );
	// Transient transport errors AND safety-filtered prompts retry: the
	// non-deterministic filter can pass the same prompt on a later attempt.
	for ( let attempt = 0; ; attempt++ ) {
		try {
			const response = await fetch( endpoint, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${ token }`,
					'x-wpcom-ai-feature': IMAGE_FEATURE_SLUG,
					'content-type': 'application/json',
				},
				body,
			} );
			const raw = await response.text();
			return { ok: true, bytes: interpretImageResponse( raw, response.status ) };
		} catch ( error ) {
			const transient =
				error instanceof TransientImageError ||
				error instanceof ImageFilteredError ||
				// fetch network failures (DNS, reset, timeout) surface as TypeError.
				error instanceof TypeError;
			if ( transient && attempt < RETRY_DELAYS_SECONDS.length ) {
				await sleep( RETRY_DELAYS_SECONDS[ attempt ] );
				continue;
			}
			return {
				ok: false,
				error: error instanceof Error ? error.message : String( error ),
				...( error instanceof ImageFilteredError ? { filtered: true } : {} ),
			};
		}
	}
}

export const generateWpcomImages: NonNullable<
	NonNullable< ProviderServices< WpcomConfig >[ 'ai' ] >[ 'generateImages' ]
> = async ( config, requests, onResult ) => {
	if ( ! config ) {
		throw new Error( 'Image generation requires a WordPress.com login (studio auth login).' );
	}
	const endpoint = `${ getAiGatewayBaseUrl() }/v1/images/generations`;
	const results: GenerateImageResult[] = new Array( requests.length );
	let next = 0;

	const worker = async () => {
		while ( next < requests.length ) {
			const index = next++;
			const result = await generateOne( endpoint, config.token, requests[ index ] );
			results[ index ] = result;
			onResult?.( index, result );
		}
	};
	await Promise.all(
		Array.from( { length: Math.min( MAX_CONCURRENT_REQUESTS, requests.length ) }, worker )
	);
	return results;
};
