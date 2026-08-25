import { describe, expect, it } from 'vitest';
import {
	STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY,
	getLoosestStudioChatImageLimits,
	getStudioChatImageEncodedBytes,
	getStudioChatImageLimits,
	validateStudioChatImages,
} from '../chat-images';

describe( 'getStudioChatImageLimits', () => {
	it( 'returns the family limits when a family is given', () => {
		expect( getStudioChatImageLimits( 'anthropic' ) ).toBe(
			STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY.anthropic
		);
		expect( getStudioChatImageLimits( 'openai' ) ).toBe(
			STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY.openai
		);
	} );

	it( 'returns the strictest value per axis when no family is given', () => {
		const strictest = getStudioChatImageLimits();
		const families = Object.values( STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY );
		expect( strictest.maxImages ).toBe( Math.min( ...families.map( ( f ) => f.maxImages ) ) );
		expect( strictest.maxImageEncodedBytes ).toBe(
			Math.min( ...families.map( ( f ) => f.maxImageEncodedBytes ) )
		);
		expect( strictest.maxTotalImageEncodedBytes ).toBe(
			Math.min( ...families.map( ( f ) => f.maxTotalImageEncodedBytes ) )
		);
	} );
} );

describe( 'getStudioChatImageEncodedBytes', () => {
	it( 'matches actual base64 sizes', () => {
		for ( const size of [ 0, 1, 2, 3, 4, 100, 1024 ] ) {
			const encoded = Buffer.from( new Uint8Array( size ) ).toString( 'base64' );
			expect( getStudioChatImageEncodedBytes( size ) ).toBe( encoded.length );
		}
	} );
} );

describe( 'validateStudioChatImages', () => {
	it( 'accepts PNG and JPEG images within limits', () => {
		expect(
			validateStudioChatImages( [
				{
					id: 'image-1',
					name: 'logo.png',
					mimeType: 'image/png',
					size: 3,
					dataBase64: 'YWJj',
				},
			] )
		).toHaveLength( 1 );
	} );

	it( 'accepts GIF and WebP images', () => {
		expect(
			validateStudioChatImages( [
				{ id: 'image-1', name: 'a.gif', mimeType: 'image/gif', size: 3, dataBase64: 'YWJj' },
				{ id: 'image-2', name: 'b.webp', mimeType: 'image/webp', size: 3, dataBase64: 'YWJj' },
			] )
		).toHaveLength( 2 );
	} );

	it( 'rejects unsupported image types', () => {
		expect( () =>
			validateStudioChatImages( [
				{
					id: 'image-1',
					name: 'logo.bmp',
					mimeType: 'image/bmp' as 'image/png',
					size: 3,
					dataBase64: 'YWJj',
				},
			] )
		).toThrow( 'Only PNG, JPEG, GIF, and WebP images can be attached.' );
	} );

	it( 'rejects more images than the loosest family allows', () => {
		const { maxImages } = getLoosestStudioChatImageLimits();
		expect( () =>
			validateStudioChatImages(
				Array.from( { length: maxImages + 1 }, ( _value, index ) => ( {
					id: `image-${ index }`,
					name: `image-${ index }.png`,
					mimeType: 'image/png',
					size: 3,
					dataBase64: 'YWJj',
				} ) )
			)
		).toThrow( `You can attach up to ${ maxImages } images.` );
	} );

	it( 'rejects images whose base64 payload exceeds the per-image limit', () => {
		const { maxImageEncodedBytes } = getLoosestStudioChatImageLimits();
		const binaryBytes = Math.ceil( ( maxImageEncodedBytes * 3 ) / 4 ) + 3;
		const dataBase64 = Buffer.from( new Uint8Array( binaryBytes ) ).toString( 'base64' );

		expect( () =>
			validateStudioChatImages( [
				{
					id: 'image-1',
					name: 'large.png',
					mimeType: 'image/png',
					size: 1,
					dataBase64,
				},
			] )
		).toThrow( /Attached images must be \d+ MB or smaller\./ );
	} );

	it( 'rejects image sets that exceed the total payload limit', () => {
		const { maxImageEncodedBytes, maxTotalImageEncodedBytes, maxImages } =
			getLoosestStudioChatImageLimits();
		const perImageBinary = Math.floor( ( maxImageEncodedBytes * 3 ) / 4 ) - 1024;
		const count = Math.min(
			maxImages,
			Math.ceil( maxTotalImageEncodedBytes / maxImageEncodedBytes ) + 1
		);
		const dataBase64 = Buffer.from( new Uint8Array( perImageBinary ) ).toString( 'base64' );

		expect( () =>
			validateStudioChatImages(
				Array.from( { length: count }, ( _value, index ) => ( {
					id: `image-${ index }`,
					name: `image-${ index }.png`,
					mimeType: 'image/png',
					size: perImageBinary,
					dataBase64,
				} ) )
			)
		).toThrow( 'Attached images are too large to send together.' );
	} );
} );
