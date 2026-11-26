import { describe, expect, it } from 'vitest';
import {
	buildImageRequestBody,
	ImageFilteredError,
	interpretImageResponse,
	resolveImageSize,
	TransientImageError,
} from '../images';

const PNG_BASE64 = Buffer.from( [
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
] ).toString( 'base64' );

describe( 'buildImageRequestBody', () => {
	it( 'always sends the image alias at medium quality as a WebP, one image, no streaming', () => {
		expect( buildImageRequestBody( 'A lake', 'portrait' ) ).toEqual( {
			model: 'image',
			prompt: 'A lake',
			quality: 'medium',
			size: '1024x1536',
			output_format: 'webp',
			output_compression: 82,
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
		expect( Buffer.from( bytes ).toString( 'base64' ) ).toBe( PNG_BASE64 );
	} );

	it( 'rejects a response without image data', () => {
		expect( () => interpretImageResponse( JSON.stringify( { data: [] } ), 200 ) ).toThrow(
			/no image data/
		);
	} );

	it( 'rejects bytes that are neither a WebP, a PNG nor a JPEG', () => {
		const gifBase64 = Buffer.from( 'GIF89a' ).toString( 'base64' );
		expect( () =>
			interpretImageResponse( JSON.stringify( { data: [ { b64_json: gifBase64 } ] } ), 200 )
		).toThrow( /neither a WebP, a PNG nor a JPEG/ );
	} );
} );
