import { describe, expect, it } from 'vitest';
import { makeSpotlightPath } from './spotlight-path';

const viewport = { width: 1000, height: 800 };

describe( 'makeSpotlightPath', () => {
	it( 'returns just the outer rect when there is no hole', () => {
		expect( makeSpotlightPath( viewport, null, 8 ) ).toBe( 'M0,0 H1000 V800 H0 Z' );
	} );

	it( 'returns just the outer rect for a degenerate (zero-size) hole', () => {
		const path = makeSpotlightPath( viewport, { x: 10, y: 10, width: 0, height: 40 }, 8 );
		expect( path ).toBe( 'M0,0 H1000 V800 H0 Z' );
	} );

	it( 'appends an inner rounded-rect subpath for a real hole', () => {
		const path = makeSpotlightPath( viewport, { x: 100, y: 100, width: 200, height: 100 }, 10 );
		// Outer rect first, then a moveTo starting the inner cutout.
		expect( path.startsWith( 'M0,0 H1000 V800 H0 Z ' ) ).toBe( true );
		expect( path ).toContain( 'M110,100' ); // x + radius, y
		expect( path ).toContain( 'A10,10' ); // rounded corners present
		expect( path.trim().endsWith( 'Z' ) ).toBe( true );
	} );

	it( 'clamps the hole to the viewport edges', () => {
		// Hole partly off the top-left; clamped origin becomes (0,0).
		const path = makeSpotlightPath( viewport, { x: -50, y: -50, width: 100, height: 100 }, 0 );
		expect( path ).toContain( 'M0,0 H50' );
	} );

	it( 'clamps the corner radius to half the smaller dimension', () => {
		// A 40x40 hole with radius 100 should clamp r to 20.
		const path = makeSpotlightPath( viewport, { x: 0, y: 0, width: 40, height: 40 }, 100 );
		expect( path ).toContain( 'A20,20' );
		expect( path ).not.toContain( 'A100,100' );
	} );

	it( 'returns the outer rect when the hole is fully outside the viewport', () => {
		const path = makeSpotlightPath( viewport, { x: 2000, y: 2000, width: 50, height: 50 }, 8 );
		expect( path ).toBe( 'M0,0 H1000 V800 H0 Z' );
	} );
} );
