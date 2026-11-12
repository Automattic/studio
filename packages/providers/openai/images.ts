import {
	FILTERED_ERROR_CODES,
	generateEach,
	ImageFilteredError,
	resolveImageSize,
	TransientImageError,
} from '../images';
import { openaiDescriptor } from './descriptor';
import type { OpenaiConfig } from './config';
import type { GenerateImageRequest, GenerateImages } from '../types';

// A ChatGPT plan generates images through the Responses API's image tool, on
// the same backend its models run on. The plan picks the quality.
const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const MAX_CONCURRENT_REQUESTS = 3;

interface ResponseEvent {
	type: string;
	item?: { result?: string };
	response?: { error?: { code?: string; message?: string } };
}

export function readImageEvents( stream: string ): Uint8Array {
	for ( const line of stream.split( '\n' ) ) {
		if ( ! line.startsWith( 'data: ' ) ) {
			continue;
		}
		const event = JSON.parse( line.slice( 6 ) ) as ResponseEvent;
		if ( event.type === 'response.output_item.done' && event.item?.result ) {
			return Uint8Array.from( atob( event.item.result ), ( char ) => char.charCodeAt( 0 ) );
		}
		const error = event.type === 'response.failed' ? event.response?.error : undefined;
		if ( error ) {
			const message = error.message ?? error.code ?? 'Image generation failed';
			throw FILTERED_ERROR_CODES.has( error.code ?? '' )
				? new ImageFilteredError( message )
				: new Error( message );
		}
	}
	throw new Error( 'ChatGPT returned no image' );
}

async function generateOne(
	config: OpenaiConfig,
	request: GenerateImageRequest
): Promise< Uint8Array > {
	const size = resolveImageSize( request.aspectRatio );
	const [ width, height ] = size.split( 'x' ).map( Number );
	const orientation = width > height ? 'Landscape' : width < height ? 'Portrait' : 'Square';
	const response = await fetch( RESPONSES_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ config.accessToken }`,
			'chatgpt-account-id': config.accountId,
			'OpenAI-Beta': 'responses=experimental',
			accept: 'text/event-stream',
			'content-type': 'application/json',
		},
		body: JSON.stringify( {
			model: openaiDescriptor.ai!.defaultModel,
			store: false,
			stream: true,
			instructions: 'Generate the image the user describes.',
			// The image tool often ignores `size` unless the prompt names the shape too.
			input: [
				{
					role: 'user',
					content: [
						{
							type: 'input_text',
							text: `${ request.prompt }\n\n${ orientation } image, ${ size }.`,
						},
					],
				},
			],
			tools: [ { type: 'image_generation', output_format: 'png', size } ],
			tool_choice: { type: 'image_generation' },
		} ),
	} );
	const stream = await response.text();
	if ( response.status === 429 || response.status >= 500 ) {
		throw new TransientImageError( `HTTP ${ response.status }: ${ stream.slice( 0, 300 ) }` );
	}
	if ( ! response.ok ) {
		throw new Error( `HTTP ${ response.status }: ${ stream.slice( 0, 500 ) }` );
	}
	return readImageEvents( stream );
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
