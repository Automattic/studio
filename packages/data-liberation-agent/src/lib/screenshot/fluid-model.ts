// src/lib/screenshot/fluid-model.ts
//
// Learn how a source sizes an element, instead of freezing one width.
//
// Sites commonly compute geometry in JavaScript and write it back as inline
// pixels. Capturing a hydrated DOM therefore captures one viewport's answer,
// and stripping the runtime for portability means nothing recomputes: the copy
// is faithful only at the width it was captured at.
//
// Observing the same element across several widths turns that into a function
// we can express in plain CSS, which needs no runtime. The fitting is pure so
// it can be tested without a browser.
//
export interface GeometrySample {
	/** Viewport width the observation was taken at. */
	viewport: number;
	/** Value the source's runtime computed, in pixels. */
	value: number;
}

export type FluidModel =
	/** Same value at every width. */
	| { kind: 'constant'; css: string; value: number }
	/** Scales with the viewport. */
	| { kind: 'proportional'; css: string; ratio: number }
	/** Scales with the viewport but never below a floor. */
	| { kind: 'floored'; css: string; ratio: number; floor: number }
	/** No single relationship fits; the source changes behavior at a width. */
	| { kind: 'breakpoint'; samples: GeometrySample[] };

/** Pixel tolerance: sub-pixel layout rounding must not defeat a good fit. */
const TOLERANCE_PX = 2;
/** Minimum observations before a relationship is credible rather than coincidence. */
const MIN_SAMPLES = 3;

function round( value: number, places = 2 ): number {
	const factor = 10 ** places;
	return Math.round( value * factor ) / factor;
}

function fits( samples: readonly GeometrySample[], predict: ( viewport: number ) => number ): boolean {
	return samples.every( ( sample ) => Math.abs( predict( sample.viewport ) - sample.value ) <= TOLERANCE_PX );
}

/**
 * Fit the simplest relationship that reproduces every observation.
 *
 * Simplest-first matters: a constant that also happens to fit a ratio should
 * stay a constant, because emitting `100vw` for a fixed-width element would
 * invent responsiveness the source never had.
 */
export function learnFluidModel( samples: readonly GeometrySample[] ): FluidModel {
	const usable = samples.filter( ( sample ) => Number.isFinite( sample.value ) && Number.isFinite( sample.viewport ) );
	if ( usable.length < MIN_SAMPLES ) {
		return { kind: 'breakpoint', samples: [ ...usable ] };
	}

	const ordered = [ ...usable ].sort( ( a, b ) => a.viewport - b.viewport );
	const values = ordered.map( ( sample ) => sample.value );

	// Constant: the element ignores viewport width.
	const min = Math.min( ...values );
	const max = Math.max( ...values );
	if ( max - min <= TOLERANCE_PX ) {
		// Median, not the last sample: one rounding artifact should not become
		// the value every width inherits.
		const sorted = [ ...values ].sort( ( a, b ) => a - b );
		const value = round( sorted[ Math.floor( sorted.length / 2 ) ]!, 0 );
		return { kind: 'constant', css: `${ value }px`, value };
	}

	// Proportional: a fixed fraction of the viewport at every width. Take the
	// ratio from the widest sample, where pixel rounding is proportionally least.
	const widest = ordered[ ordered.length - 1 ]!;
	const ratio = widest.value / widest.viewport;
	if ( fits( ordered, ( viewport ) => ratio * viewport ) ) {
		return { kind: 'proportional', css: `${ round( ratio * 100 ) }vw`, ratio };
	}

	// Floored: proportional above a threshold, pinned to a minimum below it.
	// This is the common "fluid down to the design canvas" idiom.
	const floor = min;
	if ( fits( ordered, ( viewport ) => Math.max( floor, ratio * viewport ) ) ) {
		return {
			kind: 'floored',
			css: `max(${ round( floor, 0 ) }px, ${ round( ratio * 100 ) }vw)`,
			ratio,
			floor: round( floor, 0 ),
		};
	}

	// Nothing single-valued fits, so the source genuinely changes behavior
	// across this range. That failure is the breakpoint signal.
	return { kind: 'breakpoint', samples: ordered };
}

/**
 * Recover the rule used by the widest stable viewport segment.
 *
 * Capture serializes desktop and mobile documents separately. A mobile rule in
 * the width sweep must not prevent the desktop document from retaining the
 * relationship it consistently follows above that breakpoint.
 */
export function learnWidestFluidModel( samples: readonly GeometrySample[] ): FluidModel {
	const wholeRange = learnFluidModel( samples );
	if ( wholeRange.kind !== 'breakpoint' ) return wholeRange;
	const breakpoints = breakpointsFrom( wholeRange.samples );
	const widestBreakpoint = breakpoints.at( -1 );
	if ( widestBreakpoint === undefined ) return wholeRange;
	const widestSegment = wholeRange.samples.filter( ( sample ) => sample.viewport >= widestBreakpoint );
	const widestModel = learnFluidModel( widestSegment );
	return widestModel.kind === 'breakpoint' ? wholeRange : widestModel;
}

/** Widths where the observed relationship changes, derived from a bad fit. */
export function breakpointsFrom( samples: readonly GeometrySample[] ): number[] {
	const ordered = [ ...samples ].sort( ( a, b ) => a.viewport - b.viewport );
	const breakpoints: number[] = [];
	for ( let index = 1; index < ordered.length; index++ ) {
		const previous = ordered[ index - 1 ]!;
		const current = ordered[ index ]!;
		const previousRatio = previous.value / previous.viewport;
		const currentRatio = current.value / current.viewport;
		// A ratio shift means the element started obeying a different rule
		// somewhere between these two widths.
		if ( Math.abs( currentRatio - previousRatio ) > 0.02 ) breakpoints.push( current.viewport );
	}
	return breakpoints;
}
