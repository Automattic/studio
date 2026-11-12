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

export function resolveImageSize( aspectRatio: string | undefined ): string {
	return IMAGE_SIZE_BY_ASPECT_RATIO[ aspectRatio ?? 'landscape' ] ?? '1536x1024';
}

// Generates each request with at most `concurrency` at once, keeping the
// requests' order in the results.
export async function generateEach(
	requests: GenerateImageRequest[],
	concurrency: number,
	generateOne: ( request: GenerateImageRequest ) => Promise< GenerateImageResult >,
	onResult?: ( index: number, result: GenerateImageResult ) => void
): Promise< GenerateImageResult[] > {
	const results: GenerateImageResult[] = new Array( requests.length );
	let next = 0;
	const worker = async () => {
		while ( next < requests.length ) {
			const index = next++;
			results[ index ] = await generateOne( requests[ index ] );
			onResult?.( index, results[ index ] );
		}
	};
	await Promise.all( Array.from( { length: Math.min( concurrency, requests.length ) }, worker ) );
	return results;
}
