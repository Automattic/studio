import { describe, expect, it } from 'vitest';
import {
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	STUDIO_CHAT_MAX_IMAGE_DIMENSION_PX,
	STUDIO_CHAT_MAX_IMAGE_PREVIEW_BYTES,
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

	it( 'rejects non-finite image dimensions', () => {
		expect( () =>
			validateStudioChatImages( [
				{
					id: 'image-1',
					name: 'logo.png',
					mimeType: 'image/png',
					size: 3,
					width: Number.NaN,
					height: Number.POSITIVE_INFINITY,
					dataBase64: 'YWJj',
				},
			] )
		).toThrow( 'Attached image dimensions must be finite numbers.' );
	} );

	it( 'rejects images above the maximum dimensions', () => {
		expect( () =>
			validateStudioChatImages( [
				{
					id: 'image-1',
					name: 'large.png',
					mimeType: 'image/png',
					size: 3,
					width: STUDIO_CHAT_MAX_IMAGE_DIMENSION_PX + 1,
					height: STUDIO_CHAT_MAX_IMAGE_DIMENSION_PX,
					dataBase64: 'YWJj',
				},
			] )
		).toThrow( 'Attached images must be 8000 pixels or smaller on each side.' );
	} );

	it( 'rejects previews that are not data URLs', () => {
		expect( () =>
			validateStudioChatImages( [
				{
					id: 'image-1',
					name: 'logo.png',
					mimeType: 'image/png',
					size: 3,
					previewDataUrl: 'https://example.com/logo.png',
					dataBase64: 'YWJj',
				},
			] )
		).toThrow( 'Attached image previews must be data URLs.' );
	} );

	it( 'rejects previews above the maximum preview size', () => {
		expect( () =>
			validateStudioChatImages( [
				{
					id: 'image-1',
					name: 'logo.png',
					mimeType: 'image/png',
					size: 3,
					previewDataUrl: `data:image/png;base64,${ 'a'.repeat(
						STUDIO_CHAT_MAX_IMAGE_PREVIEW_BYTES
					) }`,
					dataBase64: 'YWJj',
				},
			] )
		).toThrow( 'Attached image previews must be 256 KB or smaller.' );
	} );
} );
