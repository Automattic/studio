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

// The Squarespace fixed-header offset, measured across the sweep ladder:
// mobile is affine in the viewport, desktop is chrome content no viewport
// formula expresses. Neither regime's rule may claim the other's widths
// globally — a mobile line claimed at 1440 would invent ~209px of padding
// where the source shows 79px. The honest carrier is the segmented model,
// so the segment shortcuts must report the breakpoint instead.
const headerOffset = at( [
	[ 390, 84.2969 ],
	[ 600, 109.5156 ],
	[ 768, 129.1563 ],
	[ 1024, 61.8438 ],
	[ 1280, 72.375 ],
	[ 1440, 79.0469 ],
	[ 1920, 88.8281 ],
] );

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

	it( 'learns an affine relationship the simpler fits cannot express', () => {
		// Measured from quinn-fluid-demo.squarespace.com: the runtime writes the
		// first section's padding-top as the fixed header's height, which on
		// mobile is a 12vw chrome padding plus ~37.5px of header content.
		const model = learnFluidModel(
			at( [
				[ 390, 84.3 ],
				[ 600, 109.5 ],
				[ 768, 129.66 ],
			] )
		);
		expect( model ).toMatchObject( { kind: 'affine', css: 'calc(12vw + 37.5px)' } );
	} );

	it( 'rejects a line that would predict negative or inverted geometry', () => {
		// A decreasing series has no positive slope, and an outlier pulls the
		// least-squares intercept negative: either would extrapolate geometry
		// the source never showed below the sampled range.
		expect(
			learnFluidModel(
				at( [
					[ 600, 300 ],
					[ 800, 250 ],
					[ 1200, 200 ],
				] )
			).kind
		).toBe( 'breakpoint' );
		expect(
			learnFluidModel(
				at( [
					[ 390, 83.5 ],
					[ 600, 128.5 ],
					[ 1024, 500 ],
				] )
			).kind
		).toBe( 'breakpoint' );
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

	it( 'keeps an affine regime out of the global segment shortcuts', () => {
		expect( learnFluidModel( headerOffset ).kind ).toBe( 'breakpoint' );
		expect( learnWidestFluidModel( headerOffset ).kind ).toBe( 'breakpoint' );
	} );

	it( 'closes an agreeing unfittable tail with the constant it observed', () => {
		const segmented = learnSegmentedFluidModel( headerOffset );
		expect( segmented ).not.toBeNull();
		const [ mobile, desktop, tail ] = segmented!.segments;
		expect( mobile ).toMatchObject( { minWidth: null, maxWidth: 1023 } );
		expect( mobile.model.kind ).toBe( 'affine' );
		expect( desktop ).toMatchObject( { minWidth: 1024, maxWidth: 1919 } );
		expect( desktop.model.kind ).toBe( 'affine' );
		expect( tail ).toMatchObject( { minWidth: 1920, maxWidth: null } );
		expect( tail.model ).toMatchObject( { kind: 'constant', css: '89px' } );
	} );

	it( 'reproduces the header offset within a pixel through its segmented rules', () => {
		const segmented = learnSegmentedFluidModel( headerOffset )!;
		const predict = ( viewport: number ) => {
			const segment = segmented.segments.find(
				( candidate ) =>
					( candidate.minWidth === null || viewport >= candidate.minWidth ) &&
					( candidate.maxWidth === null || viewport <= candidate.maxWidth )
			);
			expect( segment ).toBeDefined();
			const model = segment!.model;
			if ( model.kind === 'constant' ) return model.value;
			const slope = Number( model.css.match( /([\d.]+)vw/ )![ 1 ] ) / 100;
			const intercept = Number( model.css.match( /([\d.]+)px/ )![ 1 ] );
			return slope * viewport + intercept;
		};
		for ( const [ viewport, value ] of [
			[ 390, 84.2969 ],
			[ 600, 109.5156 ],
			[ 768, 129.1563 ],
			[ 1024, 61.8438 ],
			[ 1280, 72.375 ],
			[ 1440, 79.0469 ],
		] ) {
			expect( Math.abs( predict( viewport ) - value ) ).toBeLessThanOrEqual( 1 );
		}
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
		expect( css ).toContain( '@media (max-width:767px) {\n[data-dla-fluid-segment="0"] { font-size: 21.42vw !important; }\n}' );
		expect( css ).toContain( '@media (min-width:768px) {\n[data-dla-fluid-segment="0"] { font-size: min(355.4px, 23.38vw) !important; }\n}' );
	} );

	it( 'emits the frozen tail as a media-scoped constant', () => {
		const segmented = learnSegmentedFluidModel( headerOffset )!;
		const css = segmentedCss( '[data-dla-fluid-segment="7"]', 'padding-top', segmented.segments );
		expect( css ).toContain( '@media (max-width:1023px) {\n[data-dla-fluid-segment="7"] { padding-top: calc(11.87vw + 38.08px) !important; }\n}' );
		expect( css ).toContain( '@media (min-width:1024px) and (max-width:1919px) {\n[data-dla-fluid-segment="7"] { padding-top: calc(4.13vw + 19.5px) !important; }\n}' );
		expect( css ).toContain( '@media (min-width:1920px) {\n[data-dla-fluid-segment="7"] { padding-top: 89px !important; }\n}' );
	} );
} );
