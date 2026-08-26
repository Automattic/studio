import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDIO_SITES_ROOT } from '../../lib/site-paths';
import {
	composeImagePrompt,
	fitToTokens,
	ImageFilteredError,
	interpretImageResponse,
	resolveAspectRatio,
	TransientImageError,
} from '../image-generation';
import { resolveImageFilePath } from '../tools/generate-images';

const JPEG_BASE64 = Buffer.from( [ 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10 ] ).toString( 'base64' );

function responseWith( parts: unknown[], extra: Record< string, unknown > = {} ): string {
	return JSON.stringify( { candidates: [ { content: { parts }, ...extra } ] } );
}

describe( 'resolveAspectRatio', () => {
	it( 'maps keywords and falls back to landscape', () => {
		expect( resolveAspectRatio( 'square' ) ).toBe( '1:1' );
		expect( resolveAspectRatio( 'card-portrait' ) ).toBe( '3:4' );
		expect( resolveAspectRatio( undefined ) ).toBe( '16:9' );
		expect( resolveAspectRatio( 'bogus' ) ).toBe( '16:9' );
	} );
} );

describe( 'composeImagePrompt', () => {
	it( 'leads with the subject and frames context as non-literal guidance', () => {
		const prompt = composeImagePrompt(
			{
				subject: 'A rustic sourdough loaf on a floured board',
				style: 'photorealistic',
				pageContext: 'menu item thumbnail',
			},
			{ siteContext: 'A neighborhood bakery.', imageGrade: 'warm natural window light' }
		);
		expect(
			prompt.startsWith( 'A rustic sourdough loaf on a floured board. Style: photorealistic' )
		).toBe( true );
		expect( prompt ).toContain( 'Art direction for all site imagery: warm natural window light.' );
		expect( prompt ).toContain( 'Composition: menu item thumbnail. A neighborhood bakery.' );
		expect( prompt ).toContain( 'never depicted literally' );
	} );

	it( 'adds the lettering clause only when the subject names a text carrier', () => {
		const clean = composeImagePrompt( { subject: 'A misty mountain range at dawn' } );
		expect( clean ).not.toContain( 'unmarked' );

		const carrier = composeImagePrompt( { subject: 'A bakery storefront at dusk' } );
		expect( carrier ).toContain( 'its face is unmarked' );
	} );

	it( 'caps prompt length by shedding trailing context, keeping the subject', () => {
		const longContext = Array( 800 ).fill( 'context' ).join( ' ' );
		const prompt = composeImagePrompt(
			{ subject: 'A red canoe on a still lake' },
			{ siteContext: longContext }
		);
		expect( prompt.startsWith( 'A red canoe on a still lake' ) ).toBe( true );
		expect( prompt.length ).toBeLessThan( longContext.length );
	} );
} );

describe( 'fitToTokens', () => {
	it( 'returns short text unchanged', () => {
		expect( fitToTokens( 'short prompt', 480 ) ).toBe( 'short prompt' );
	} );
} );

describe( 'interpretImageResponse', () => {
	it( 'classifies 429 and 5xx as transient', () => {
		expect( () => interpretImageResponse( 'rate limited', 429 ) ).toThrow( TransientImageError );
		expect( () => interpretImageResponse( 'oops', 503 ) ).toThrow( TransientImageError );
	} );

	it( 'classifies other non-2xx as permanent', () => {
		expect( () => interpretImageResponse( 'forbidden', 403 ) ).toThrow( /HTTP 403/ );
		expect( () => interpretImageResponse( 'forbidden', 403 ) ).not.toThrow( TransientImageError );
	} );

	it( 'detects safety filtering from finish reasons and block reasons', () => {
		expect( () =>
			interpretImageResponse( responseWith( [], { finishReason: 'IMAGE_SAFETY' } ), 200 )
		).toThrow( ImageFilteredError );
		expect( () =>
			interpretImageResponse(
				JSON.stringify( { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } ),
				200
			)
		).toThrow( ImageFilteredError );
		// Ordinary no-image finish reasons are permanent failures, not filtering.
		expect( () =>
			interpretImageResponse( responseWith( [], { finishReason: 'MAX_TOKENS' } ), 200 )
		).toThrow( /no image data/ );
	} );

	it( 'extracts JPEG bytes, skipping text and thought parts', () => {
		const raw = responseWith( [
			{ text: 'here is your image' },
			{ thought: true, inlineData: { data: JPEG_BASE64 } },
			{ inlineData: { data: JPEG_BASE64, mimeType: 'image/jpeg' } },
		] );
		const bytes = interpretImageResponse( raw, 200 );
		expect( bytes[ 0 ] ).toBe( 0xff );
		expect( bytes[ 1 ] ).toBe( 0xd8 );
	} );

	it( 'rejects non-JPEG bytes so they are never written under a .jpg name', () => {
		const pngBase64 = Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a ] ).toString( 'base64' );
		expect( () =>
			interpretImageResponse( responseWith( [ { inlineData: { data: pngBase64 } } ] ), 200 )
		).toThrow( /not a JPEG/ );
	} );
} );

describe( 'resolveImageFilePath', () => {
	it( 'accepts .jpg paths inside the sites root', () => {
		const target = path.join( STUDIO_SITES_ROOT, 'my-site', 'wp-content', 'a.jpg' );
		expect( resolveImageFilePath( target ) ).toBe( target );
	} );

	it( 'rejects paths escaping the sites root', () => {
		expect( () =>
			resolveImageFilePath( path.join( STUDIO_SITES_ROOT, '..', 'escape.jpg' ) )
		).toThrow( /inside the Studio sites directory/ );
	} );

	it( 'rejects non-JPEG extensions', () => {
		expect( () => resolveImageFilePath( path.join( STUDIO_SITES_ROOT, 'a.png' ) ) ).toThrow(
			/end in .jpg/
		);
	} );
} );
