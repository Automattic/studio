import { describe, expect, it, vi } from 'vitest';
import { NotConnectedError } from '../../errors';
import { TransientImageError } from '../../wpcom/ai/images';
import { generateXaiImages, xaiImageDialect } from '../images';

const { body, read } = xaiImageDialect;

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUg==';
const gifBase64 = 'R0lGODlhAQABAA==';

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

	it( 'renders with either credential, and needs one', async () => {
		const sent: ( string | undefined )[] = [];
		vi.stubGlobal( 'fetch', async ( _url: string, init: { headers: Record< string, string > } ) => {
			sent.push( init.headers.authorization );
			return Response.json( { data: [ { b64_json: pngBase64, mime_type: 'image/png' } ] } );
		} );

		await generateXaiImages(
			{ method: 'grok', accessToken: 'grok-access', refreshToken: 'r', accessTokenExpiresAt: 0 },
			[ { prompt: 'a shop front' } ]
		);
		await generateXaiImages( { method: 'api-key', apiKey: 'xai-key' }, [
			{ prompt: 'a shop front' },
		] );
		expect( sent ).toEqual( [ 'Bearer grok-access', 'Bearer xai-key' ] );

		vi.unstubAllGlobals();
		await expect(
			generateXaiImages( undefined, [ { prompt: 'a shop front' } ] )
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
		const gif = JSON.stringify( { data: [ { b64_json: gifBase64, mime_type: 'image/gif' } ] } );
		expect( () => read( gif, 200 ) ).toThrow( /image\/gif.*neither a WebP, a PNG nor a JPEG/ );
	} );
} );
