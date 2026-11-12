import { generateEach, resolveImageSize } from '../images';
import { openaiDescriptor } from './descriptor';
import type { OpenaiConfig } from './config';
import type { GenerateImageRequest, GenerateImageResult, GenerateImages } from '../types';

// A ChatGPT plan generates images through the Responses API's image tool, on
// the same backend its models run on. The plan picks the quality.
const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const MAX_CONCURRENT_REQUESTS = 3;
const RETRY_DELAYS_SECONDS = [ 2, 5, 12 ];
const FILTERED_ERROR_CODES = new Set( [ 'moderation_blocked', 'content_policy_violation' ] );

class TransientImageError extends Error {}

interface ResponseEvent {
	type: string;
	item?: { type: string; result?: string };
	response?: { error?: { code?: string; message?: string } };
}

// The image from the response's event stream, or why there is none.
export function readImageEvents( stream: string ): GenerateImageResult {
	for ( const block of stream.split( '\n\n' ) ) {
		const data = block
			.split( '\n' )
			.find( ( line ) => line.startsWith( 'data: ' ) )
			?.slice( 6 );
		let event: ResponseEvent;
		try {
			event = JSON.parse( data ?? '' );
		} catch {
			continue;
		}
		if ( event.type === 'response.output_item.done' && event.item?.result ) {
			const bytes = Uint8Array.from( atob( event.item.result ), ( char ) => char.charCodeAt( 0 ) );
			return { ok: true, bytes };
		}
		const error = event.type === 'response.failed' ? event.response?.error : undefined;
		if ( error ) {
			return {
				ok: false,
				error: error.message ?? error.code ?? 'Image generation failed',
				...( FILTERED_ERROR_CODES.has( error.code ?? '' ) ? { filtered: true } : {} ),
			};
		}
	}
	return { ok: false, error: 'ChatGPT returned no image' };
}

async function generateOne(
	config: OpenaiConfig,
	request: GenerateImageRequest
): Promise< GenerateImageResult > {
	const size = resolveImageSize( request.aspectRatio );
	const [ width, height ] = size.split( 'x' ).map( Number );
	const orientation = width > height ? 'Landscape' : width < height ? 'Portrait' : 'Square';
	const body = JSON.stringify( {
		model: openaiDescriptor.ai!.defaultModel,
		store: false,
		stream: true,
		instructions: 'Generate the image the user describes.',
		// The image tool often ignores `size` unless the prompt names the shape too.
		input: [
			{
				role: 'user',
				content: [
					{ type: 'input_text', text: `${ request.prompt }\n\n${ orientation } image, ${ size }.` },
				],
			},
		],
		tools: [
			{
				type: 'image_generation',
				output_format: 'png',
				size,
			},
		],
		tool_choice: { type: 'image_generation' },
	} );
	for ( let attempt = 0; ; attempt++ ) {
		try {
			const response = await fetch( RESPONSES_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${ config.accessToken }`,
					'chatgpt-account-id': config.accountId,
					'OpenAI-Beta': 'responses=experimental',
					accept: 'text/event-stream',
					'content-type': 'application/json',
				},
				body,
			} );
			const stream = await response.text();
			if ( response.status === 429 || response.status >= 500 ) {
				throw new TransientImageError( `HTTP ${ response.status }: ${ stream.slice( 0, 300 ) }` );
			}
			if ( ! response.ok ) {
				return { ok: false, error: `HTTP ${ response.status }: ${ stream.slice( 0, 500 ) }` };
			}
			return readImageEvents( stream );
		} catch ( error ) {
			// fetch network failures (DNS, reset, timeout) surface as TypeError.
			const transient = error instanceof TransientImageError || error instanceof TypeError;
			if ( transient && attempt < RETRY_DELAYS_SECONDS.length ) {
				await new Promise( ( resolve ) =>
					setTimeout( resolve, RETRY_DELAYS_SECONDS[ attempt ] * 1000 )
				);
				continue;
			}
			return { ok: false, error: error instanceof Error ? error.message : String( error ) };
		}
	}
}

export const generateOpenaiImages: GenerateImages< OpenaiConfig > = async (
	config,
	requests,
	onResult
) => {
	if ( ! config ) {
		throw new Error( 'Image generation requires signing in with ChatGPT.' );
	}
	return generateEach(
		requests,
		MAX_CONCURRENT_REQUESTS,
		( request ) => generateOne( config, request ),
		onResult
	);
};
