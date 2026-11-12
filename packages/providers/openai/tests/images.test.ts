import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateOpenaiImages, readImageEvents } from '../images';

const events = ( ...items: object[] ) =>
	items.map( ( item ) => `event: x\ndata: ${ JSON.stringify( item ) }` ).join( '\n\n' );
const imageDone = {
	type: 'response.output_item.done',
	item: { type: 'image_generation_call', result: btoa( 'png-bytes' ) },
};

describe( 'readImageEvents', () => {
	it( 'decodes the generated image', () => {
		const result = readImageEvents( events( { type: 'response.created' }, imageDone ) );

		expect( new TextDecoder().decode( result.bytes ) ).toBe( 'png-bytes' );
	} );

	it( 'flags a prompt the safety filter refused, and reports a missing image', () => {
		expect(
			readImageEvents(
				events( {
					type: 'response.failed',
					response: { error: { code: 'moderation_blocked', message: 'Blocked' } },
				} )
			)
		).toEqual( { ok: false, error: 'Blocked', filtered: true } );
		expect( readImageEvents( events( { type: 'response.completed' } ) ) ).toMatchObject( {
			ok: false,
		} );
	} );
} );

describe( 'generateOpenaiImages', () => {
	afterEach( () => vi.unstubAllGlobals() );

	it( 'asks the ChatGPT backend for each image at the slot’s size', async () => {
		const fetchMock = vi.fn( async () => new Response( events( imageDone ) ) );
		vi.stubGlobal( 'fetch', fetchMock );
		const config = {
			method: 'chatgpt',
			accessToken: 'access',
			refreshToken: 'refresh',
			accessTokenExpiresAt: Date.now() + 3600_000,
			accountId: 'account',
		} as const;

		const results = await generateOpenaiImages( config, [
			{ prompt: 'A bird', aspectRatio: 'portrait' },
		] );

		expect( results ).toMatchObject( [ { ok: true } ] );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as unknown as [ string, RequestInit ];
		expect( url ).toBe( 'https://chatgpt.com/backend-api/codex/responses' );
		expect( init.headers ).toMatchObject( { 'chatgpt-account-id': 'account' } );
		expect( JSON.parse( String( init.body ) ) ).toMatchObject( {
			tools: [ { type: 'image_generation', size: '1024x1536' } ],
			tool_choice: { type: 'image_generation' },
		} );
	} );
} );
