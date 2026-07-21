import { describe, expect, it } from 'vitest';
import {
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	STUDIO_CHAT_MAX_IMAGES,
	validateStudioChatImages,
} from '../chat-images';

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

	it( 'rejects too many images', () => {
		expect( () =>
			validateStudioChatImages(
				Array.from( { length: STUDIO_CHAT_MAX_IMAGES + 1 }, ( _value, index ) => ( {
					id: `image-${ index }`,
					name: `image-${ index }.png`,
					mimeType: 'image/png',
					size: 3,
					dataBase64: 'YWJj',
				} ) )
			)
		).toThrow( `You can attach up to ${ STUDIO_CHAT_MAX_IMAGES } images.` );
	} );

	it( 'rejects oversized images from decoded base64 size', () => {
		const bytes = new Uint8Array( STUDIO_CHAT_MAX_IMAGE_BYTES + 1 );
		const dataBase64 = Buffer.from( bytes ).toString( 'base64' );

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
		).toThrow( 'Attached images must be 5 MB or smaller.' );
	} );
} );
