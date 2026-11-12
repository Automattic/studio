import type { GenerateImageRequest, GenerateImageResult } from './types';

// Image models render only these three canvases, so each slot shape maps to
// the nearest one and CSS crops to the slot.
const IMAGE_SIZE_BY_ASPECT_RATIO: Record< string, string > = {
	square: '1024x1024',
	landscape: '1536x1024',
	ultrawide: '1536x1024',
	portrait: '1024x1536',
	'card-landscape': '1536x1024',
	'card-portrait': '1024x1536',
};
const RETRY_DELAYS_SECONDS = [ 2, 5, 12 ];

// Error codes OpenAI's image models return when the moderation system rejected
// the prompt; any other failure must not be reported as repairable-by-rewriting.
export const FILTERED_ERROR_CODES = new Set( [ 'moderation_blocked', 'content_policy_violation' ] );

export class TransientImageError extends Error {}
export class ImageFilteredError extends Error {}

export function resolveImageSize( aspectRatio: string | undefined ): string {
	return IMAGE_SIZE_BY_ASPECT_RATIO[ aspectRatio ?? 'landscape' ] ?? '1536x1024';
}

// Transient failures and safety-filtered prompts retry: the non-deterministic
// filter can pass the same prompt on a later attempt.
async function generateWithRetries( generate: () => Promise< Uint8Array > ) {
	for ( let attempt = 0; ; attempt++ ) {
		try {
			return { ok: true, bytes: await generate() };
		} catch ( error ) {
			const transient =
				error instanceof TransientImageError ||
				error instanceof ImageFilteredError ||
				// fetch network failures (DNS, reset, timeout) surface as TypeError.
				error instanceof TypeError;
			if ( transient && attempt < RETRY_DELAYS_SECONDS.length ) {
				await new Promise( ( resolve ) =>
					setTimeout( resolve, RETRY_DELAYS_SECONDS[ attempt ] * 1000 )
				);
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

// Generates each request with at most `concurrency` at once, keeping the
// requests' order. `generate` throws the errors above to have a request retried.
export async function generateEach(
	requests: GenerateImageRequest[],
	concurrency: number,
	generate: ( request: GenerateImageRequest ) => Promise< Uint8Array >,
	onResult?: ( index: number, result: GenerateImageResult ) => void
): Promise< GenerateImageResult[] > {
	const results: GenerateImageResult[] = new Array( requests.length );
	let next = 0;
	const worker = async () => {
		while ( next < requests.length ) {
			const index = next++;
			results[ index ] = await generateWithRetries( () => generate( requests[ index ] ) );
			onResult?.( index, results[ index ] );
		}
	};
	await Promise.all( Array.from( { length: Math.min( concurrency, requests.length ) }, worker ) );
	return results;
}
