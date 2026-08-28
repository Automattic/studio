import { describe, expect, it, vi } from 'vitest';
import {
	findBreakpoints,
	signatureDistance,
	type LayoutSignature,
} from './breakpoint-finder.js';

/**
 * A synthetic site: two columns at or above `breakpoint`, one column below.
 * Everything scales fluidly within each region, which is exactly the case a
 * naive width-sampling detector mistakes for a breakpoint at every width.
 */
function twoColumnSite( breakpoint: number ) {
	return async ( width: number ): Promise< LayoutSignature > =>
		width >= breakpoint
			? { boxes: { a: [ 0, 0.5 ], b: [ 0.5, 0.5 ] } }
			: { boxes: { a: [ 0, 1 ], b: [ 0, 1 ] } };
}

describe( 'signatureDistance', () => {
	it( 'reports no change when a layout only scales', () => {
		// Same ratios at different viewports: pure fluid scaling.
		expect(
			signatureDistance( { boxes: { a: [ 0, 0.5 ] } }, { boxes: { a: [ 0, 0.5 ] } } )
		).toBe( 0 );
	} );

	it( 'reports the jump when a column collapses', () => {
		expect(
			signatureDistance( { boxes: { a: [ 0, 0.5 ] } }, { boxes: { a: [ 0, 1 ] } } )
		).toBeCloseTo( 0.5 );
	} );

	it( 'treats wholesale appearance of elements as discrete', () => {
		expect(
			signatureDistance( { boxes: { a: [ 0, 0.5 ] } }, { boxes: { a: [ 0, 0.5 ], b: [ 0, 0.5 ], c: [ 0, 0.5 ] } } )
		).toBe( Number.POSITIVE_INFINITY );
	} );
} );

describe( 'findBreakpoints', () => {
	it( 'locates a breakpoint that sits between the coarse sample widths', async () => {
		// 782 is not a sampled width; only bisection can find it.
		const { breakpoints } = await findBreakpoints( twoColumnSite( 782 ), { precision: 2 } );
		expect( breakpoints ).toHaveLength( 1 );
		expect( breakpoints[ 0 ] ).toBeGreaterThanOrEqual( 780 );
		expect( breakpoints[ 0 ] ).toBeLessThanOrEqual( 784 );
	} );

	it( 'reports nothing for a purely fluid layout', async () => {
		// Ratios never change, so every width is the same layout.
		const fluid = async (): Promise< LayoutSignature > => ( { boxes: { a: [ 0, 1 ], b: [ 0, 0.5 ] } } );
		expect( ( await findBreakpoints( fluid ) ).breakpoints ).toEqual( [] );
	} );

	it( 'finds several breakpoints in one pass', async () => {
		const site = async ( width: number ): Promise< LayoutSignature > => {
			if ( width >= 1100 ) return { boxes: { a: [ 0, 0.33 ] } };
			if ( width >= 700 ) return { boxes: { a: [ 0, 0.5 ] } };
			return { boxes: { a: [ 0, 1 ] } };
		};
		const { breakpoints } = await findBreakpoints( site, { precision: 2 } );
		expect( breakpoints ).toHaveLength( 2 );
		expect( breakpoints[ 0 ] ).toBeGreaterThanOrEqual( 698 );
		expect( breakpoints[ 0 ] ).toBeLessThanOrEqual( 702 );
		expect( breakpoints[ 1 ] ).toBeGreaterThanOrEqual( 1098 );
		expect( breakpoints[ 1 ] ).toBeLessThanOrEqual( 1102 );
	} );

	it( 'detects a breakpoint that only adds an element', async () => {
		const site = async ( width: number ): Promise< LayoutSignature > =>
			width >= 900
				? { boxes: { a: [ 0, 0.7 ], b: [ 0.7, 0.3 ] } }
				: { boxes: { a: [ 0, 1 ] } };
		const { breakpoints } = await findBreakpoints( site, { precision: 2 } );
		expect( breakpoints[ 0 ] ).toBeGreaterThanOrEqual( 898 );
		expect( breakpoints[ 0 ] ).toBeLessThanOrEqual( 902 );
	} );

	it( 'stays within its probe budget on a pathological source', async () => {
		// Different layout at every width: bisection must not run away.
		const probe = vi.fn(
			async ( width: number ): Promise< LayoutSignature > => ( { boxes: { a: [ 0, width / 4000 ] } } )
		);
		const { probes } = await findBreakpoints( probe, { maxProbes: 24 } );
		expect( probes ).toBeLessThanOrEqual( 24 );
	} );

	it( 'reuses measurements instead of re-probing a width', async () => {
		const probe = vi.fn( twoColumnSite( 782 ) );
		await findBreakpoints( probe, { precision: 2 } );
		const widths = probe.mock.calls.map( ( [ width ] ) => width );
		expect( new Set( widths ).size ).toBe( widths.length );
	} );
} );
