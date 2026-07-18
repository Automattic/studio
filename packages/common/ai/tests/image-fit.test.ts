import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	STUDIO_CHAT_IMAGE_FIT_MAX_DIMENSION,
	STUDIO_CHAT_IMAGE_FIT_MAX_ENCODED_BYTES,
} from '../chat-images';
import { fitImageFileWithinLimits } from '../image-fit';
import { stubImageEnvironment } from './utils/image-stubs';

afterEach( () => {
	vi.unstubAllGlobals();
} );

describe( 'fitImageFileWithinLimits', () => {
	it( 'downscales an oversized image to the dimension limit and re-encodes as JPEG', async () => {
		const { close, createdCanvases } = stubImageEnvironment( { width: 9000, height: 4500 } );
		const original = new File( [ new Uint8Array( 1024 ) ], 'huge.png', { type: 'image/png' } );

		const fitted = await fitImageFileWithinLimits( original );

		expect( createdCanvases ).toEqual( [
			{
				width: STUDIO_CHAT_IMAGE_FIT_MAX_DIMENSION,
				height: STUDIO_CHAT_IMAGE_FIT_MAX_DIMENSION / 2,
			},
		] );
		expect( fitted ).not.toBe( original );
		expect( fitted.type ).toBe( 'image/jpeg' );
		expect( fitted.name ).toBe( 'huge.jpg' );
		expect( close ).toHaveBeenCalled();
	} );

	it( 'keeps PNG encoding when the downscaled image has transparency', async () => {
		stubImageEnvironment( { width: 3000, height: 9000, transparent: true } );
		const original = new File( [ new Uint8Array( 1024 ) ], 'logo.png', { type: 'image/png' } );

		const fitted = await fitImageFileWithinLimits( original );

		expect( fitted.type ).toBe( 'image/png' );
		expect( fitted.name ).toBe( 'logo.png' );
	} );

	it( 're-encodes an image that fits dimensions but exceeds the byte budget', async () => {
		stubImageEnvironment( { width: 1800, height: 1200 } );
		// Binary size chosen so the base64 payload exceeds the fit budget.
		const oversized = Math.ceil( ( STUDIO_CHAT_IMAGE_FIT_MAX_ENCODED_BYTES * 3 ) / 4 ) + 1024;
		const original = new File( [ new Uint8Array( oversized ) ], 'dense.png', {
			type: 'image/png',
		} );

		const fitted = await fitImageFileWithinLimits( original );

		expect( fitted ).not.toBe( original );
		expect( fitted.type ).toBe( 'image/jpeg' );
	} );

	it( 'walks JPEG quality down, then dimensions, until the encoded size fits', async () => {
		const budgetBinary = Math.floor( ( STUDIO_CHAT_IMAGE_FIT_MAX_ENCODED_BYTES * 3 ) / 4 );
		let attempt = 0;
		const { createdCanvases, encodeAttempts } = stubImageEnvironment( {
			width: 4000,
			height: 4000,
			// First four attempts (full quality ladder at 2000px) stay oversized;
			// the fifth (first attempt at 1500px) fits.
			blobBytes: () => ( ++attempt <= 4 ? budgetBinary + 1024 : 1024 ),
		} );
		const original = new File( [ new Uint8Array( 1024 ) ], 'photo.png', { type: 'image/png' } );

		const fitted = await fitImageFileWithinLimits( original );

		expect( fitted.type ).toBe( 'image/jpeg' );
		expect( encodeAttempts.length ).toBe( 5 );
		expect( createdCanvases ).toEqual( [
			{ width: 2000, height: 2000 },
			{ width: 1500, height: 1500 },
		] );
	} );

	it( 'returns the original file when no attempt fits above the minimum dimension', async () => {
		const budgetBinary = Math.floor( ( STUDIO_CHAT_IMAGE_FIT_MAX_ENCODED_BYTES * 3 ) / 4 );
		stubImageEnvironment( {
			width: 4000,
			height: 4000,
			blobBytes: () => budgetBinary + 1024,
		} );
		const original = new File( [ new Uint8Array( 1024 ) ], 'stubborn.png', {
			type: 'image/png',
		} );

		await expect( fitImageFileWithinLimits( original ) ).resolves.toBe( original );
	} );

	it( 'returns the original file when it already fits within the limits', async () => {
		const { createdCanvases } = stubImageEnvironment( { width: 800, height: 600 } );
		const original = new File( [ new Uint8Array( 1024 ) ], 'small.png', { type: 'image/png' } );

		await expect( fitImageFileWithinLimits( original ) ).resolves.toBe( original );
		expect( createdCanvases ).toEqual( [] );
	} );

	it( 'returns the original file when createImageBitmap is unavailable', async () => {
		const original = new File( [ new Uint8Array( 1024 ) ], 'image.png', { type: 'image/png' } );

		await expect( fitImageFileWithinLimits( original ) ).resolves.toBe( original );
	} );

	it( 'returns the original file when the image cannot be decoded', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn( async () => {
				throw new Error( 'Invalid image' );
			} )
		);
		const original = new File( [ 'not-an-image' ], 'broken.png', { type: 'image/png' } );

		await expect( fitImageFileWithinLimits( original ) ).resolves.toBe( original );
	} );
} );
