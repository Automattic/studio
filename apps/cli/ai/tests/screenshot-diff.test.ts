import { PNG } from 'pngjs';
import { describe, it, expect, beforeEach } from 'vitest';
import {
	diffScreenshots,
	storeReference,
	getReference,
	clearReference,
	clearAllReferences,
} from 'cli/ai/screenshot-diff';

/**
 * Creates a solid-colored PNG buffer.
 */
function createSolidPng(
	width: number,
	height: number,
	color: [ number, number, number, number ] = [ 255, 255, 255, 255 ]
): Buffer {
	const png = new PNG( { width, height } );
	for ( let y = 0; y < height; y++ ) {
		for ( let x = 0; x < width; x++ ) {
			const idx = ( y * width + x ) * 4;
			png.data[ idx ] = color[ 0 ];
			png.data[ idx + 1 ] = color[ 1 ];
			png.data[ idx + 2 ] = color[ 2 ];
			png.data[ idx + 3 ] = color[ 3 ];
		}
	}
	return PNG.sync.write( png );
}

/**
 * Creates a PNG with the top half one color and bottom half another.
 */
function createTwoTonePng(
	width: number,
	height: number,
	topColor: [ number, number, number, number ],
	bottomColor: [ number, number, number, number ]
): Buffer {
	const png = new PNG( { width, height } );
	const midpoint = Math.floor( height / 2 );
	for ( let y = 0; y < height; y++ ) {
		const color = y < midpoint ? topColor : bottomColor;
		for ( let x = 0; x < width; x++ ) {
			const idx = ( y * width + x ) * 4;
			png.data[ idx ] = color[ 0 ];
			png.data[ idx + 1 ] = color[ 1 ];
			png.data[ idx + 2 ] = color[ 2 ];
			png.data[ idx + 3 ] = color[ 3 ];
		}
	}
	return PNG.sync.write( png );
}

describe( 'diffScreenshots', () => {
	it( 'should report 0% change for identical images', async () => {
		const png = createSolidPng( 100, 100 );
		const result = await diffScreenshots( png, png );

		expect( result.changePercent ).toBe( 0 );
		expect( result.changedPixels ).toBe( 0 );
		expect( result.totalPixels ).toBe( 10000 );
		expect( result.width ).toBe( 100 );
		expect( result.height ).toBe( 100 );
		expect( result.diffPng ).toBeInstanceOf( Buffer );
	} );

	it( 'should detect changes between different images', async () => {
		const white = createSolidPng( 100, 100, [ 255, 255, 255, 255 ] );
		const red = createSolidPng( 100, 100, [ 255, 0, 0, 255 ] );
		const result = await diffScreenshots( white, red );

		expect( result.changePercent ).toBeGreaterThan( 0 );
		expect( result.changedPixels ).toBeGreaterThan( 0 );
	} );

	it( 'should detect partial changes', async () => {
		const allWhite = createSolidPng( 100, 100, [ 255, 255, 255, 255 ] );
		const halfRed = createTwoTonePng( 100, 100, [ 255, 0, 0, 255 ], [ 255, 255, 255, 255 ] );
		const result = await diffScreenshots( allWhite, halfRed );

		// Top half changed, bottom half identical — roughly 50%
		expect( result.changePercent ).toBeGreaterThan( 30 );
		expect( result.changePercent ).toBeLessThan( 70 );
	} );

	it( 'should handle images with different heights by padding', async () => {
		const short = createSolidPng( 100, 50, [ 255, 255, 255, 255 ] );
		const tall = createSolidPng( 100, 100, [ 255, 255, 255, 255 ] );
		const result = await diffScreenshots( short, tall );

		expect( result.height ).toBe( 100 );
		expect( result.width ).toBe( 100 );
		// The padded area (transparent vs white) will show as changed
		expect( result.changedPixels ).toBeGreaterThan( 0 );
	} );

	it( 'should throw on width mismatch', async () => {
		const narrow = createSolidPng( 50, 100 );
		const wide = createSolidPng( 100, 100 );

		await expect( diffScreenshots( narrow, wide ) ).rejects.toThrow( 'Width mismatch' );
	} );

	it( 'should return a valid PNG in the diff output', async () => {
		const white = createSolidPng( 10, 10, [ 255, 255, 255, 255 ] );
		const black = createSolidPng( 10, 10, [ 0, 0, 0, 255 ] );
		const result = await diffScreenshots( white, black );

		// Should be parseable as a PNG
		const parsed = PNG.sync.read( result.diffPng );
		expect( parsed.width ).toBe( 10 );
		expect( parsed.height ).toBe( 10 );
	} );
} );

describe( 'reference store', () => {
	beforeEach( () => {
		clearAllReferences();
	} );

	it( 'should store and retrieve references', () => {
		const png = createSolidPng( 10, 10 );
		storeReference( 'http://example.com', 'desktop', png );

		const retrieved = getReference( 'http://example.com', 'desktop' );
		expect( retrieved ).toBe( png );
	} );

	it( 'should return undefined for missing references', () => {
		expect( getReference( 'http://example.com', 'desktop' ) ).toBeUndefined();
	} );

	it( 'should separate references by viewport', () => {
		const desktopPng = createSolidPng( 10, 10, [ 255, 0, 0, 255 ] );
		const mobilePng = createSolidPng( 10, 10, [ 0, 255, 0, 255 ] );

		storeReference( 'http://example.com', 'desktop', desktopPng );
		storeReference( 'http://example.com', 'mobile', mobilePng );

		expect( getReference( 'http://example.com', 'desktop' ) ).toBe( desktopPng );
		expect( getReference( 'http://example.com', 'mobile' ) ).toBe( mobilePng );
	} );

	it( 'should clear a specific reference', () => {
		const png = createSolidPng( 10, 10 );
		storeReference( 'http://example.com', 'desktop', png );
		clearReference( 'http://example.com', 'desktop' );

		expect( getReference( 'http://example.com', 'desktop' ) ).toBeUndefined();
	} );

	it( 'should clear all references', () => {
		const png = createSolidPng( 10, 10 );
		storeReference( 'http://a.com', 'desktop', png );
		storeReference( 'http://b.com', 'mobile', png );
		clearAllReferences();

		expect( getReference( 'http://a.com', 'desktop' ) ).toBeUndefined();
		expect( getReference( 'http://b.com', 'mobile' ) ).toBeUndefined();
	} );
} );
