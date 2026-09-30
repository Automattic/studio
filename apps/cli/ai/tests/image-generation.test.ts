import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDIO_SITES_ROOT } from '../../lib/site-paths';
import {
	buildImageRequestBody,
	composeImagePrompt,
	fitToTokens,
	ImageFilteredError,
	interpretImageResponse,
	resolveImageSize,
	TransientImageError,
} from '../image-generation';
import { resolveImageFilePath } from '../tools/generate-images';

const PNG_BASE64 = Buffer.from( [
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
] ).toString( 'base64' );

describe( 'buildImageRequestBody', () => {
	it( 'always sends the image alias at medium quality, one image, no streaming', () => {
		expect( buildImageRequestBody( 'A lake', 'portrait' ) ).toEqual( {
			model: 'image',
			prompt: 'A lake',
			quality: 'medium',
			size: '1024x1536',
		} );
	} );
} );

describe( 'resolveImageSize', () => {
	it( 'maps landscape and portrait shapes to the route sizes, square otherwise', () => {
		expect( resolveImageSize( 'ultrawide' ) ).toBe( '1536x1024' );
		expect( resolveImageSize( 'card-landscape' ) ).toBe( '1536x1024' );
		expect( resolveImageSize( 'card-portrait' ) ).toBe( '1024x1536' );
		expect( resolveImageSize( 'square' ) ).toBe( '1024x1024' );
		expect( resolveImageSize( undefined ) ).toBe( '1536x1024' );
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

	it( 'detects moderation rejections as safety filtering', () => {
		const blocked = JSON.stringify( {
			error: { code: 'moderation_blocked', message: 'Rejected by the safety system' },
		} );
		expect( () => interpretImageResponse( blocked, 400 ) ).toThrow( ImageFilteredError );
		expect( () =>
			interpretImageResponse( JSON.stringify( { error: { code: 'invalid_value' } } ), 400 )
		).not.toThrow( ImageFilteredError );
	} );

	it( 'extracts PNG bytes from the first result', () => {
		const bytes = interpretImageResponse(
			JSON.stringify( { data: [ { b64_json: PNG_BASE64 } ] } ),
			200
		);
		expect( bytes.toString( 'base64' ) ).toBe( PNG_BASE64 );
	} );

	it( 'rejects a response without image data', () => {
		expect( () => interpretImageResponse( JSON.stringify( { data: [] } ), 200 ) ).toThrow(
			/no image data/
		);
	} );

	it( 'rejects non-PNG bytes so they are never written under a .png name', () => {
		const jpegBase64 = Buffer.from( [ 0xff, 0xd8, 0xff, 0xe0 ] ).toString( 'base64' );
		expect( () =>
			interpretImageResponse( JSON.stringify( { data: [ { b64_json: jpegBase64 } ] } ), 200 )
		).toThrow( /not a PNG/ );
	} );
} );

describe( 'resolveImageFilePath', () => {
	it( 'accepts .png paths inside the sites root', () => {
		const target = path.join( STUDIO_SITES_ROOT, 'my-site', 'wp-content', 'a.png' );
		expect( resolveImageFilePath( target ) ).toBe( target );
	} );

	it( 'rejects paths escaping the sites root', () => {
		expect( () =>
			resolveImageFilePath( path.join( STUDIO_SITES_ROOT, '..', 'escape.png' ) )
		).toThrow( /inside the Studio sites directory/ );
	} );

	it( 'rejects non-PNG extensions', () => {
		expect( () => resolveImageFilePath( path.join( STUDIO_SITES_ROOT, 'a.jpg' ) ) ).toThrow(
			/end in .png/
		);
	} );
} );
