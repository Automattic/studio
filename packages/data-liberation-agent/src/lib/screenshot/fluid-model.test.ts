import { describe, expect, it } from 'vitest';
import { breakpointsFrom, learnFluidModel, learnWidestFluidModel } from './fluid-model.js';

const at = ( pairs: Array< [ number, number ] > ) =>
	pairs.map( ( [ viewport, value ] ) => ( { viewport, value } ) );

describe( 'learnFluidModel', () => {
	it( 'learns the floored model observed on a real Wix site', () => {
		// Measured from www.roeeby.com: full-bleed image, runtime-written widths.
		const model = learnFluidModel(
			at( [
				[ 390, 980 ],
				[ 768, 980 ],
				[ 1024, 1024 ],
				[ 1280, 1280 ],
				[ 1440, 1440 ],
				[ 1600, 1600 ],
				[ 1920, 1920 ],
			] )
		);
		expect( model ).toMatchObject( { kind: 'floored', css: 'max(980px, 100vw)' } );
	} );

	it( 'learns the two-column half-width case from the same site', () => {
		const model = learnFluidModel(
			at( [
				[ 390, 490 ],
				[ 768, 490 ],
				[ 1024, 512 ],
				[ 1280, 640 ],
				[ 1440, 720 ],
				[ 1600, 800 ],
				[ 1920, 960 ],
			] )
		);
		expect( model ).toMatchObject( { kind: 'floored', css: 'max(490px, 50vw)' } );
	} );

	it( 'keeps a fixed-width element constant instead of inventing responsiveness', () => {
		const model = learnFluidModel(
			at( [
				[ 768, 320 ],
				[ 1280, 320 ],
				[ 1920, 321 ],
			] )
		);
		expect( model ).toMatchObject( { kind: 'constant', css: '320px' } );
	} );

	it( 'learns a plain proportional element', () => {
		const model = learnFluidModel(
			at( [
				[ 800, 400 ],
				[ 1200, 600 ],
				[ 1600, 800 ],
			] )
		);
		expect( model ).toMatchObject( { kind: 'proportional', css: '50vw', ratio: 0.5 } );
	} );

	it( 'tolerates sub-pixel rounding rather than failing the fit', () => {
		const model = learnFluidModel(
			at( [
				[ 800, 399 ],
				[ 1200, 601 ],
				[ 1600, 800 ],
			] )
		);
		expect( model.kind ).toBe( 'proportional' );
	} );

	it( 'reports a breakpoint when no single relationship fits', () => {
		// Half width on narrow screens, full width on wide ones: a real change
		// of rule, not a model this fitter should paper over.
		const model = learnFluidModel(
			at( [
				[ 600, 300 ],
				[ 800, 400 ],
				[ 1200, 1200 ],
				[ 1600, 1600 ],
			] )
		);
		expect( model.kind ).toBe( 'breakpoint' );
	} );

	it( 'refuses to model too few observations', () => {
		expect( learnFluidModel( at( [ [ 800, 400 ], [ 1600, 800 ] ] ) ).kind ).toBe( 'breakpoint' );
	} );

	it( 'ignores non-finite observations', () => {
		const model = learnFluidModel( [
			{ viewport: 800, value: Number.NaN },
			{ viewport: 1200, value: 600 },
			{ viewport: 1600, value: 800 },
		] );
		expect( model.kind ).toBe( 'breakpoint' );
	} );
} );

describe( 'learnWidestFluidModel', () => {
	it( 'recovers the desktop relationship after a mobile breakpoint', () => {
		const model = learnWidestFluidModel(
			at( [
				[ 768, 844 ],
				[ 1024, 559 ],
				[ 1280, 699 ],
				[ 1440, 787 ],
				[ 1920, 1049 ],
			] )
		);
		expect( model ).toMatchObject( { kind: 'proportional', css: '54.64vw' } );
	} );

	it( 'keeps a breakpoint when the widest segment has too little evidence', () => {
		expect(
			learnWidestFluidModel(
				at( [
					[ 600, 300 ],
					[ 800, 400 ],
					[ 1200, 1200 ],
					[ 1600, 1600 ],
				] )
			).kind
		).toBe( 'breakpoint' );
	} );
} );

describe( 'breakpointsFrom', () => {
	it( 'locates the width where the rule changes', () => {
		expect(
			breakpointsFrom(
				at( [
					[ 600, 300 ],
					[ 800, 400 ],
					[ 1200, 1200 ],
					[ 1600, 1600 ],
				] )
			)
		).toEqual( [ 1200 ] );
	} );

	it( 'reports nothing for a consistently proportional element', () => {
		expect(
			breakpointsFrom(
				at( [
					[ 800, 400 ],
					[ 1200, 600 ],
					[ 1600, 800 ],
				] )
			)
		).toEqual( [] );
	} );
} );
