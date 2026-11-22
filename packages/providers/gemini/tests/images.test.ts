import { describe, expect, it } from 'vitest';
import { ImageFilteredError, TransientImageError } from '../../wpcom/ai/images';
import { geminiImageDialect } from '../images';

const { body, read } = geminiImageDialect;

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUg==';
const jpegBase64 = '/9j/4AAQSkZJRg==';

const withImage = ( data: string, mimeType = 'image/png' ) =>
	JSON.stringify( {
		candidates: [ { content: { parts: [ { inlineData: { mimeType, data } } ] } } ],
	} );

describe( 'the Gemini image request', () => {
	it( 'asks for an image on the canvas the slot wants', () => {
		expect( body( { prompt: 'a shop front', aspectRatio: 'portrait' }, 'ignored' ) ).toEqual( {
			contents: [ { parts: [ { text: 'a shop front' } ] } ],
			generationConfig: {
				responseModalities: [ 'IMAGE' ],
				imageConfig: { aspectRatio: '9:16' },
			},
		} );
	} );

	it( 'falls back to landscape for a missing or unknown shape', () => {
		for ( const aspectRatio of [ undefined, 'billboard' ] ) {
			expect( body( { prompt: 'a shop front', aspectRatio }, 'ignored' ) ).toMatchObject( {
				generationConfig: { imageConfig: { aspectRatio: '16:9' } },
			} );
		}
	} );
} );

describe( 'the Gemini image response', () => {
	it( 'returns the inline PNG bytes', () => {
		expect( read( withImage( pngBase64 ), 200 ) ).toEqual(
			Uint8Array.from( atob( pngBase64 ), ( char ) => char.charCodeAt( 0 ) )
		);
	} );

	it( 'classifies rate limits and server errors as transient', () => {
		expect( () => read( 'rate limited', 429 ) ).toThrow( TransientImageError );
		expect( () => read( 'oops', 503 ) ).toThrow( TransientImageError );
	} );

	it( 'classifies a rejected key as permanent', () => {
		const raw = JSON.stringify( { error: { status: 'INVALID_ARGUMENT', message: 'bad key' } } );
		expect( () => read( raw, 400 ) ).toThrow( /bad key/ );
		expect( () => read( raw, 400 ) ).not.toThrow( TransientImageError );
	} );

	it.each( [
		[ 'the prompt', JSON.stringify( { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } ) ],
		[ 'the image', JSON.stringify( { candidates: [ { finishReason: 'IMAGE_SAFETY' } ] } ) ],
	] )( 'reports a safety verdict on %s as filtering, which a rewrite can pass', ( _what, raw ) => {
		expect( () => read( raw, 200 ) ).toThrow( ImageFilteredError );
	} );

	it( 'says why the model drew nothing when it answers in words', () => {
		const raw = JSON.stringify( {
			candidates: [ { content: { parts: [ { text: 'I can’t draw that.' } ] } } ],
		} );
		expect( () => read( raw, 200 ) ).toThrow( /I can’t draw that/ );
	} );

	it( 'refuses bytes that are not a PNG, which Studio writes under a .png name', () => {
		expect( () => read( withImage( jpegBase64, 'image/jpeg' ), 200 ) ).toThrow( /image\/jpeg/ );
	} );
} );
