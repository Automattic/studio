import { describe, expect, it } from 'vitest';
import {
	breakpointsFrom,
	learnFluidModel,
	learnSegmentedFluidModel,
	learnWidestFluidModel,
	segmentedCss,
} from './fluid-model.js';

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

	it( 'learns the capped display type observed on a real Squarespace site', () => {
		// Measured from quinn-fluid-demo.squarespace.com: runtime-written
		// font-size that grows with the viewport until a 355.3px ceiling.
		const model = learnFluidModel(
			at( [
				[ 768, 179.4 ],
				[ 1024, 239.5 ],
				[ 1280, 299.2 ],
				[ 1440, 336.6 ],
				[ 1920, 355.3 ],
			] )
		);
		expect( model ).toMatchObject( {
			kind: 'capped',
			css: 'min(355.3px, 23.39vw)',
			cap: 355.3,
		} );
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

	// The regression this guards: an element that merely fills its parent was
	// described as a share of the screen. That reads correctly only while the
	// parent spans the viewport, and re-anchors the element to the screen
	// everywhere else — a narrower container, or an editor canvas.
	it( 'describes a parent-filling element by its container, not the screen', () => {
		const model = learnFluidModel( [
			{ viewport: 1024, value: 1024, container: 1024 },
			{ viewport: 1440, value: 1440, container: 1440 },
			{ viewport: 1920, value: 1920, container: 1920 },
		] );
		expect( model ).toMatchObject( { kind: 'container', css: '100%', ratio: 1 } );
	} );

	it( 'keeps viewport units when the element does not track its container', () => {
		const model = learnFluidModel( [
			{ viewport: 1024, value: 512, container: 1024 },
			{ viewport: 1440, value: 720, container: 900 },
			{ viewport: 1920, value: 960, container: 700 },
		] );
		expect( model ).toMatchObject( { kind: 'proportional', css: '50vw' } );
	} );

	// A container that never moves cannot prove the relationship: equality at a
	// single size is a coincidence, not evidence of filling the parent.
	it( 'does not infer a container fit from an unchanging container', () => {
		const model = learnFluidModel( [
			{ viewport: 1024, value: 512, container: 1000 },
			{ viewport: 1440, value: 720, container: 1000 },
			{ viewport: 1920, value: 960, container: 1000 },
		] );
		expect( model.kind ).toBe( 'proportional' );
	} );

	it( 'still prefers a constant over a container fit', () => {
		const model = learnFluidModel( [
			{ viewport: 1024, value: 200, container: 1024 },
			{ viewport: 1440, value: 200, container: 1440 },
			{ viewport: 1920, value: 200, container: 1920 },
		] );
		expect( model ).toMatchObject( { kind: 'constant', css: '200px' } );
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

describe( 'learnSegmentedFluidModel', () => {
	// Measured from quinn-fluid-demo.squarespace.com: the "PORTFOLIO" headline
	// is scaled text the runtime sizes to fill its container, and the container
	// is 88% of a phone viewport but 96% of a desktop one, saturating at 1459px
	// on the site canvas. No single expression reproduces both regimes.
	const scaledHeadline = at( [
		[ 390, 83.5 ],
		[ 600, 128.5 ],
		[ 768, 179.4 ],
		[ 1024, 239.3 ],
		[ 1280, 299.2 ],
		[ 1440, 336.6 ],
		[ 1600, 355.4 ],
		[ 1728, 355.4 ],
		[ 1920, 355.4 ],
	] );

	it( 'fits one rule per regime for the Squarespace scaled headline', () => {
		expect( learnFluidModel( scaledHeadline ).kind ).toBe( 'breakpoint' );
		const segmented = learnSegmentedFluidModel( scaledHeadline );
		expect( segmented ).not.toBeNull();
		expect( segmented!.segments ).toHaveLength( 2 );
		const [ mobile, desktop ] = segmented!.segments;
		expect( mobile ).toMatchObject( { minWidth: null, maxWidth: 767 } );
		expect( mobile.model ).toMatchObject( { kind: 'proportional', css: '21.42vw' } );
		expect( desktop ).toMatchObject( { minWidth: 768, maxWidth: null } );
		expect( desktop.model ).toMatchObject( { kind: 'capped', css: 'min(355.4px, 23.38vw)' } );
	} );

	it( 'renders every sampled width within tolerance through its rules', () => {
		const segmented = learnSegmentedFluidModel( scaledHeadline )!;
		const predict = ( viewport: number ) => {
			const segment = segmented.segments.find(
				( candidate ) =>
					( candidate.minWidth === null || viewport >= candidate.minWidth ) &&
					( candidate.maxWidth === null || viewport <= candidate.maxWidth )
			);
			expect( segment ).toBeDefined();
			const ratio = Number( segment!.model.css.match( /([\d.]+)vw/ )![ 1 ] ) / 100;
			const cap = segment!.model.kind === 'capped' ? segment!.model.cap : Infinity;
			return Math.min( cap, ratio * viewport );
		};
		for ( const [ viewport, value ] of [
			[ 390, 83.5 ],
			[ 600, 128.5 ],
			[ 768, 179.4 ],
			[ 1024, 239.3 ],
			[ 1280, 299.2 ],
			[ 1440, 336.6 ],
			[ 1600, 355.4 ],
			[ 1728, 355.4 ],
			[ 1920, 355.4 ],
		] ) {
			expect( Math.abs( predict( viewport ) - value ) ).toBeLessThanOrEqual( 2 );
		}
	} );

	it( 'refuses a split when a sample fits no regime', () => {
		// The 1024 observation obeys no rule its neighbours share, so the
		// honest outcome is no model rather than a partial guess.
		expect(
			learnSegmentedFluidModel(
				at( [
					[ 390, 83.5 ],
					[ 600, 128.5 ],
					[ 1024, 500 ],
					[ 1280, 299.2 ],
					[ 1440, 336.6 ],
				] )
			)
		).toBeNull();
	} );

	it( 'does not split when a single relationship already fits', () => {
		expect(
			learnSegmentedFluidModel(
				at( [
					[ 390, 100 ],
					[ 600, 200 ],
					[ 768, 300 ],
					[ 1024, 400 ],
				] )
			)
		).toBeNull();
	} );

	it( 'emits nested media rules', () => {
		const segmented = learnSegmentedFluidModel( scaledHeadline )!;
		const css = segmentedCss( '[data-dla-fluid-segment="0"]', 'font-size', segmented.segments );
		expect( css ).toContain( '@media (max-width:767px) {\n[data-dla-fluid-segment="0"] { font-size: 21.42vw; }\n}' );
		expect( css ).toContain( '@media (min-width:768px) {\n[data-dla-fluid-segment="0"] { font-size: min(355.4px, 23.38vw); }\n}' );
	} );
} );
