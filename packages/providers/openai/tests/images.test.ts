import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageFilteredError } from '../../images';
import { generateOpenaiImages, readImageEvents } from '../images';

const events = ( ...items: object[] ) =>
	items.map( ( item ) => `event: x\ndata: ${ JSON.stringify( item ) }\n\n` ).join( '' );
const imageDone = { type: 'response.output_item.done', item: { result: btoa( 'png-bytes' ) } };

describe( 'openai images', () => {
	afterEach( () => vi.unstubAllGlobals() );

	it( 'reads the image from the event stream, or the safety filter’s refusal', () => {
		expect( new TextDecoder().decode( readImageEvents( events( imageDone ) ) ) ).toBe(
			'png-bytes'
		);
		expect( () =>
			readImageEvents(
				events( { type: 'response.failed', response: { error: { code: 'moderation_blocked' } } } )
			)
		).toThrow( ImageFilteredError );
	} );

	it( 'asks the ChatGPT backend for each image at the slot’s size', async () => {
		const fetchMock = vi.fn( async () => new Response( events( imageDone ) ) );
		vi.stubGlobal( 'fetch', fetchMock );

		await expect(
			generateOpenaiImages(
				{
					method: 'chatgpt',
					accessToken: 'access',
					refreshToken: 'refresh',
					accessTokenExpiresAt: 0,
					accountId: 'account',
				},
				[ { prompt: 'A bird', aspectRatio: 'portrait' } ]
			)
		).resolves.toMatchObject( [ { ok: true } ] );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as unknown as [ string, RequestInit ];
		expect( url ).toBe( 'https://chatgpt.com/backend-api/codex/responses' );
		expect( JSON.parse( String( init.body ) ) ).toMatchObject( {
			tools: [ { type: 'image_generation', size: '1024x1536' } ],
		} );
	} );
} );
