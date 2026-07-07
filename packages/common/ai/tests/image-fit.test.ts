import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CHAT_IMAGE_DIMENSION, fitImageFileWithinLimit } from '../image-fit';
import { stubImageEnvironment } from './utils/image-stubs';

afterEach( () => {
	vi.unstubAllGlobals();
} );

describe( 'fitImageFileWithinLimit', () => {
	it( 'downscales an oversized image to the dimension limit and re-encodes as JPEG', async () => {
		const { close, createdCanvases } = stubImageEnvironment( { width: 9000, height: 4500 } );
		const original = new File( [ new Uint8Array( 1024 ) ], 'huge.png', { type: 'image/png' } );

		const fitted = await fitImageFileWithinLimit( original );

		expect( createdCanvases ).toEqual( [
			{ width: MAX_CHAT_IMAGE_DIMENSION, height: MAX_CHAT_IMAGE_DIMENSION / 2 },
		] );
		expect( fitted ).not.toBe( original );
		expect( fitted.type ).toBe( 'image/jpeg' );
		expect( fitted.name ).toBe( 'huge.jpg' );
		expect( fitted.size ).toBe( 'downscaled'.length );
		expect( close ).toHaveBeenCalled();
	} );

	it( 'keeps PNG encoding when the downscaled image has transparency', async () => {
		stubImageEnvironment( { width: 3000, height: 9000, transparent: true } );
		const original = new File( [ new Uint8Array( 1024 ) ], 'logo.png', { type: 'image/png' } );

		const fitted = await fitImageFileWithinLimit( original );

		expect( fitted.type ).toBe( 'image/png' );
		expect( fitted.name ).toBe( 'logo.png' );
	} );

	it( 'returns the original file when it already fits within the limit', async () => {
		const { createdCanvases } = stubImageEnvironment( { width: 800, height: 600 } );
		const original = new File( [ new Uint8Array( 1024 ) ], 'small.png', { type: 'image/png' } );

		await expect( fitImageFileWithinLimit( original ) ).resolves.toBe( original );
		expect( createdCanvases ).toEqual( [] );
	} );

	it( 'returns the original file when createImageBitmap is unavailable', async () => {
		const original = new File( [ new Uint8Array( 1024 ) ], 'image.png', { type: 'image/png' } );

		await expect( fitImageFileWithinLimit( original ) ).resolves.toBe( original );
	} );

	it( 'returns the original file when the image cannot be decoded', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn( async () => {
				throw new Error( 'Invalid image' );
			} )
		);
		const original = new File( [ 'not-an-image' ], 'broken.png', { type: 'image/png' } );

		await expect( fitImageFileWithinLimit( original ) ).resolves.toBe( original );
	} );
} );
