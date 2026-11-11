import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { InvalidCredentialError } from '../../errors';
import { connectCustom } from '../account';
import { customAi } from '../ai';

type Seen = { path?: string; authorization?: string; apiKey?: string; model: string };

// A local endpoint answering "ok" in the APIs it `speaks`, and 404 on any other path.
async function serve( speaks: Array< 'openai' | 'anthropic' > ) {
	const seen: Seen[] = [];
	const sse = ( event: { type?: string; [ key: string ]: unknown } ) =>
		`${ event.type ? `event: ${ event.type }\n` : '' }data: ${ JSON.stringify( event ) }\n\n`;
	const server = createServer( ( request, response ) => {
		let body = '';
		request.on( 'data', ( chunk ) => ( body += chunk ) );
		request.on( 'end', () => {
			// pi's Anthropic client adds `?beta=true`.
			const path = request.url?.split( '?' )[ 0 ];
			seen.push( {
				path,
				authorization: request.headers.authorization,
				apiKey: request.headers[ 'x-api-key' ] as string | undefined,
				model: JSON.parse( body ).model,
			} );
			if ( path === '/v1/chat/completions' && speaks.includes( 'openai' ) ) {
				response.writeHead( 200, { 'content-type': 'text/event-stream' } );
				response.end(
					sse( {
						id: '1',
						choices: [ { index: 0, delta: { content: 'ok' }, finish_reason: 'stop' } ],
					} ) + 'data: [DONE]\n\n'
				);
				return;
			}
			if ( path === '/v1/messages' && speaks.includes( 'anthropic' ) ) {
				response.writeHead( 200, { 'content-type': 'text/event-stream' } );
				response.end(
					[
						{
							type: 'message_start',
							message: { id: 'm', usage: { input_tokens: 1, output_tokens: 0 } },
						},
						{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
						{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
						{ type: 'content_block_stop', index: 0 },
						{
							type: 'message_delta',
							delta: { stop_reason: 'end_turn' },
							usage: { output_tokens: 1 },
						},
						{ type: 'message_stop' },
					]
						.map( sse )
						.join( '' )
				);
				return;
			}
			response.writeHead( 404, { 'content-type': 'application/json' } );
			response.end( JSON.stringify( { error: { message: 'not found' } } ) );
		} );
	} );
	await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
	const { port } = server.address() as { port: number };
	return { seen, server, url: `http://127.0.0.1:${ port }` };
}

const form = ( url: string, images = 'no' ) => ( {
	url: ` ${ url }/ `,
	apiKey: ' the-key ',
	model: ' vendor/model ',
	images,
} );

describe( 'connecting a custom endpoint', () => {
	it.each( [
		{
			speaks: 'openai' as const,
			entered: '/v1',
			paths: [ '/v1/chat/completions' ],
			saved: { baseUrl: '/v1', api: 'openai-completions' },
		},
		{
			speaks: 'anthropic' as const,
			entered: '/v1',
			paths: [ '/v1/chat/completions', '/v1/messages' ],
			saved: { baseUrl: '', api: 'anthropic-messages' },
		},
		{
			speaks: 'anthropic' as const,
			entered: '',
			paths: [ '/chat/completions', '/v1/messages' ],
			saved: { baseUrl: '', api: 'anthropic-messages' },
		},
	] )(
		'saves the API a $speaks endpoint at "$entered" answers in, after the model answers',
		async ( { speaks, entered, paths, saved } ) => {
			const { seen, server, url } = await serve( [ speaks ] );
			try {
				const config = await connectCustom( form( `${ url }${ entered }`, 'Yes' ) );
				expect( seen.map( ( call ) => call.path ) ).toEqual( paths );
				expect( seen.at( -1 ) ).toMatchObject(
					speaks === 'openai'
						? { authorization: 'Bearer the-key', model: 'vendor/model' }
						: { apiKey: 'the-key', model: 'vendor/model' }
				);
				expect( config ).toEqual( {
					baseUrl: `${ url }${ saved.baseUrl }`,
					api: saved.api,
					apiKey: 'the-key',
					model: 'vendor/model',
					images: true,
				} );

				// A turn's connection names the endpoint's model in the request only.
				const ai = await customAi.connect( config, 'custom', {} );
				expect( ai ).toMatchObject( {
					apiKey: 'the-key',
					requestModelId: 'vendor/model',
					model: { id: 'custom', api: saved.api, input: [ 'text', 'image' ] },
				} );
			} finally {
				server.close();
			}
		},
		60000
	);

	it( 'saves nothing when the model answers in no API, and says what each answered', async () => {
		const { server, url } = await serve( [] );
		try {
			const connecting = connectCustom( form( url ) );
			await expect( connecting ).rejects.toBeInstanceOf( InvalidCredentialError );
			await expect( connecting ).rejects.toThrow(
				/^The endpoint did not answer for vendor\/model, so it was not saved: .*404.* \/ .*404/
			);
		} finally {
			server.close();
		}
	}, 60000 );
} );
