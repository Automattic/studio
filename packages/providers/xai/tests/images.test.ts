import { describe, expect, it } from 'vitest';
import { NotConnectedError } from '../../errors';
import { TransientImageError } from '../../wpcom/ai/images';
import { generateXaiImages, xaiImageDialect } from '../images';

const { body, read } = xaiImageDialect;

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUg==';
const jpegBase64 = '/9j/4AAQSkZJRg==';

describe( 'the xAI image request', () => {
	it( 'asks for the canvas the slot wants, as a ratio', () => {
		expect(
			body( { prompt: 'a shop front', aspectRatio: 'portrait' }, 'grok-imagine-image-2.0' )
		).toEqual( {
			model: 'grok-imagine-image-2.0',
			prompt: 'a shop front',
			aspect_ratio: '9:16',
			resolution: '2k',
			response_format: 'b64_json',
		} );
		expect( body( { prompt: 'a shop front' }, 'grok-imagine-image-2.0' ) ).toMatchObject( {
			aspect_ratio: '16:9',
		} );
	} );

	it( 'needs an API key, since a Grok plan carries no xAI credits', async () => {
		await expect(
			generateXaiImages(
				{ method: 'grok', accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: 0 },
				[ { prompt: 'a shop front' } ]
			)
		).rejects.toBeInstanceOf( NotConnectedError );
	} );
} );

describe( 'the xAI image response', () => {
	it( 'returns the PNG bytes', () => {
		const raw = JSON.stringify( { data: [ { b64_json: pngBase64, mime_type: 'image/png' } ] } );
		expect( read( raw, 200 ) ).toEqual(
			Uint8Array.from( atob( pngBase64 ), ( char ) => char.charCodeAt( 0 ) )
		);
	} );

	it( 'retries a busy or failing backend', () => {
		expect( () => read( 'rate limited', 429 ) ).toThrow( TransientImageError );
		expect( () => read( '{}', 503 ) ).toThrow( TransientImageError );
	} );

	it( 'says what xAI sent instead of an image', () => {
		const raw = JSON.stringify( { error: { message: 'out of credits' } } );
		expect( () => read( raw, 402 ) ).toThrow( /out of credits/ );
		expect( () => read( '{"data":[]}', 200 ) ).toThrow( /no image/ );
		const jpeg = JSON.stringify( { data: [ { b64_json: jpegBase64, mime_type: 'image/jpeg' } ] } );
		expect( () => read( jpeg, 200 ) ).toThrow( /image\/jpeg.*not a PNG/ );
	} );
} );
