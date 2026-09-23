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
	/**
	 * Content-box size of the element's layout parent on the same axis.
	 *
	 * Absent when the axis has no meaningful container, which simply removes
	 * the container-relative candidate rather than changing the other fits.
	 */
	container?: number | null;
}

export type FluidModel =
	/** Same value at every width. */
	| { kind: 'constant'; css: string; value: number }
	/** Scales with its own container. */
	| { kind: 'container'; css: string; ratio: number }
	/** Scales with the viewport. */
	| { kind: 'proportional'; css: string; ratio: number }
	/** Scales with the viewport but never below a floor. */
	| { kind: 'floored'; css: string; ratio: number; floor: number }
	/** Scales with the viewport but never above a ceiling. */
	| { kind: 'capped'; css: string; ratio: number; cap: number }
	/** Scales with the viewport plus a fixed offset: calc(a*vw + b px). */
	| { kind: 'affine'; css: string; slope: number; intercept: number }
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

	// Container-relative: the element tracks its own parent, not the screen.
	// Preferred over the viewport fit for the same reason a constant is
	// preferred over a ratio — emitting `100vw` for an element that merely
	// fills its parent invents a dependency on the screen that the source
	// never had, and it only looks correct while that parent happens to span
	// the viewport. A percentage reproduces the observed relationship in any
	// container, including one narrower than the screen.
	const containers = ordered.map( ( sample ) =>
		typeof sample.container === 'number' && Number.isFinite( sample.container ) && sample.container > 0
			? sample.container
			: null
	);
	if ( containers.every( ( container ): container is number => container !== null ) ) {
		const containerRatio = ordered[ ordered.length - 1 ]!.value / containers[ containers.length - 1 ]!;
		const containerFits = ordered.every(
			( sample, index ) => Math.abs( containerRatio * containers[ index ]! - sample.value ) <= TOLERANCE_PX
		);
		// A container that never changes cannot distinguish "fills its parent"
		// from "happens to equal it once", so require it to have actually moved.
		const containerVaries =
			Math.max( ...containers ) - Math.min( ...containers ) > TOLERANCE_PX;
		if ( containerFits && containerVaries ) {
			return { kind: 'container', css: `${ round( containerRatio * 100 ) }%`, ratio: containerRatio };
		}
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

	// Capped: proportional up to a ceiling. The mirror of the floored idiom —
	// display type that grows with the viewport only until a maximum size. The
	// slope comes from the steepest observation because capped samples report a
	// flattened ratio; the ceiling then absorbs everything above the switch.
	const cap = max;
	const cappedRatio = Math.max( ...ordered.map( ( sample ) => sample.value / sample.viewport ) );
	if ( fits( ordered, ( viewport ) => Math.min( cap, cappedRatio * viewport ) ) ) {
		return {
			kind: 'capped',
			css: `min(${ round( cap ) }px, ${ round( cappedRatio * 100 ) }vw)`,
			ratio: cappedRatio,
			cap: round( cap ),
		};
	}

	// Affine: viewport-proportional growth plus a fixed offset — the shape of
	// geometry that composes a fluid term with a constant one (a header offset
	// is padding that scales with the screen plus fixed chrome content).
	// Tried after every simpler relationship and held to a physically sane
	// line: a non-positive slope or a negative intercept would predict
	// inverted or negative geometry below the sampled range.
	const line = leastSquaresLine( ordered );
	if (
		line &&
		line.slope > 0 &&
		line.intercept >= 0 &&
		fits( ordered, ( viewport ) => line.slope * viewport + line.intercept )
	) {
		return {
			kind: 'affine',
			css: `calc(${ round( line.slope * 100 ) }vw + ${ round( line.intercept ) }px)`,
			slope: line.slope,
			intercept: line.intercept,
		};
	}

	// Nothing single-valued fits, so the source genuinely changes behavior
	// across this range. That failure is the breakpoint signal.
	return { kind: 'breakpoint', samples: ordered };
}

/**
 * Least-squares line through the observations, or null when degenerate.
 *
 * The fit itself is only a candidate: callers decide whether a line is a
 * plausible description of the source.
 */
function leastSquaresLine(
	ordered: readonly GeometrySample[]
): { slope: number; intercept: number } | null {
	const count = ordered.length;
	if ( count < 2 ) return null;
	const meanViewport = ordered.reduce( ( sum, sample ) => sum + sample.viewport, 0 ) / count;
	const meanValue = ordered.reduce( ( sum, sample ) => sum + sample.value, 0 ) / count;
	let squaredSpread = 0;
	let covariance = 0;
	for ( const sample of ordered ) {
		squaredSpread += ( sample.viewport - meanViewport ) ** 2;
		covariance += ( sample.viewport - meanViewport ) * ( sample.value - meanValue );
	}
	if ( squaredSpread === 0 ) return null;
	const slope = covariance / squaredSpread;
	return { slope, intercept: meanValue - slope * meanViewport };
}

/**
 * Recover the rule used by the widest stable viewport segment.
 *
 * Capture serializes desktop and mobile documents separately. A mobile rule in
 * the width sweep must not prevent the desktop document from retaining the
 * relationship it consistently follows above that breakpoint.
 *
 * An affine fit is never returned from the segment shortcuts: its slope and
 * offset describe one regime, and extrapolating that line across an unsampled
 * other regime invents geometry the source never showed. When a segment only
 * fits affinely, the honest carrier is a media-scoped segmented model, which
 * this function signals by reporting the breakpoint.
 */
export function learnWidestFluidModel( samples: readonly GeometrySample[] ): FluidModel {
	const wholeRange = learnFluidModel( samples );
	if ( wholeRange.kind !== 'breakpoint' ) return wholeRange;
	const breakpoints = breakpointsFrom( wholeRange.samples );
	const widestBreakpoint = breakpoints.at( -1 );
	if ( widestBreakpoint === undefined ) return wholeRange;
	const widestSegment = wholeRange.samples.filter( ( sample ) => sample.viewport >= widestBreakpoint );
	const widestModel = learnFluidModel( widestSegment );
	if ( widestModel.kind !== 'breakpoint' && widestModel.kind !== 'affine' ) return widestModel;

	// A capped value at the last sampled width leaves only one observation in the
	// final segment. Prefer the preceding stable relationship over freezing the
	// whole document; a later sweep can still teach the cap when it has enough
	// samples on both sides of that breakpoint.
	const precedingSegment = wholeRange.samples.filter( ( sample ) => sample.viewport < widestBreakpoint );
	const precedingModel = learnFluidModel( precedingSegment );
	return precedingModel.kind === 'breakpoint' || precedingModel.kind === 'affine'
		? wholeRange
		: precedingModel;
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

// ---------------------------------------------------------------------------
// Piecewise models
// ---------------------------------------------------------------------------

export interface FluidModelSegment {
	/** The relationship holding on this stretch of widths. */
	model: ViewportFluidModel;
	/** Inclusive lower bound of the stretch, null when it extends indefinitely. */
	minWidth: number | null;
	/** Inclusive upper bound of the stretch, null when it extends indefinitely. */
	maxWidth: number | null;
}

export interface SegmentedFluidModel {
	kind: 'segmented';
	segments: FluidModelSegment[];
}

/** A relationship expressible from the viewport alone — no container premise. */
export type ViewportFluidModel = Exclude< FluidModel, { kind: 'breakpoint' } >;

/**
 * Fit one viewport-expressible relationship to a run of observations.
 *
 * Segments are held to viewport-expressible kinds on purpose: a segmented rule
 * ships into a stylesheet and must keep predicting the source once the runtime
 * is gone. A container-relative fit depends on the exported copy reflowing the
 * parent box exactly as the source did, which a layout frozen into static flow
 * cannot promise — a viewport fit carries no such assumption.
 */
function viewportModelForRun( run: readonly GeometrySample[] ): ViewportFluidModel | null {
	if ( run.length < 2 ) return null;
	if ( run.length === 2 ) {
		const [ first, second ] = run;
		if ( Math.abs( second.value - first.value ) <= TOLERANCE_PX ) {
			return { kind: 'constant', css: `${ round( ( first.value + second.value ) / 2, 0 ) }px`, value: first.value };
		}
		const ratio = second.value / second.viewport;
		if ( fits( run, ( viewport ) => ratio * viewport ) ) {
			return { kind: 'proportional', css: `${ round( ratio * 100 ) }vw`, ratio };
		}
		return null;
	}
	const model = learnFluidModel( run );
	if (
		model.kind === 'constant' ||
		model.kind === 'proportional' ||
		model.kind === 'floored' ||
		model.kind === 'capped' ||
		model.kind === 'affine'
	) {
		return model;
	}
	return null;
}

/**
 * Recover the source's behavior as one rule per regime.
 *
 * Sources routinely obey one rule above their mobile breakpoint and another
 * below it: the container a headline fills is 96% of a desktop viewport but
 * 88% of a phone, so no single vw expression reproduces both regimes and the
 * whole-range fit classifies the element as unmodelled. When the observations
 * split into consecutive runs that each fit a viewport-expressible model, the
 * piecewise result is the honest description — each regime says what it saw.
 *
 * A trailing stretch that fits no model closes the segmentation with a
 * constant when its own samples agree with each other: the constant
 * reproduces within tolerance what a frozen copy already showed on that
 * stretch, so it can only match or beat freezing, never guess past the
 * observations. A disagreeing tail is noise or an outlier, and refusing the
 * whole split stays the honest outcome.
 *
 * Returns null unless every sample is covered by such a run, so callers can
 * fall back to freezing rather than ship a partial guess.
 */
export function learnSegmentedFluidModel(
	samples: readonly GeometrySample[]
): SegmentedFluidModel | null {
	const usable = samples
		.filter( ( sample ) => Number.isFinite( sample.value ) && Number.isFinite( sample.viewport ) )
		.sort( ( a, b ) => a.viewport - b.viewport );
	// Two regimes with two observations each is the least evidence that
	// distinguishes a genuine regime change from pixel noise.
	if ( usable.length < 4 ) return null;

	const runs: Array< { model: ViewportFluidModel; start: number; end: number } > = [];
	let start = 0;
	while ( start < usable.length ) {
		let matched: { model: ViewportFluidModel; end: number } | null = null;
		for ( let end = usable.length; end > start + 1; end-- ) {
			const model = viewportModelForRun( usable.slice( start, end ) );
			if ( model !== null ) {
				matched = { model, end };
				break;
			}
		}
		if ( matched === null ) {
			// An unfittable remainder closes as the constant it observed — but
			// only when those observations agree with each other; otherwise an
			// outlier would ship a confident wrong value for its whole stretch.
			const tail = usable.slice( start );
			const values = tail.map( ( sample ) => sample.value );
			if ( Math.max( ...values ) - Math.min( ...values ) > TOLERANCE_PX ) return null;
			const sorted = [ ...values ].sort( ( a, b ) => a - b );
			runs.push( {
				model: {
					kind: 'constant',
					css: `${ round( sorted[ Math.floor( sorted.length / 2 ) ]!, 0 ) }px`,
					value: sorted[ Math.floor( sorted.length / 2 ) ]!,
				},
				start,
				end: usable.length,
			} );
			break;
		}
		runs.push( { model: matched.model, start, end: matched.end } );
		start = matched.end;
	}

	// Adjacent runs that learned the same expression are one regime.
	const merged: Array< { model: ViewportFluidModel; start: number; end: number } > = [];
	for ( const run of runs ) {
		const previous = merged[ merged.length - 1 ];
		if ( previous && previous.model.css === run.model.css ) {
			previous.end = run.end;
			continue;
		}
		merged.push( { ...run } );
	}
	if ( merged.length < 2 ) return null;

	const segments: FluidModelSegment[] = merged.map( ( run, index ) => ( {
		model: run.model,
		minWidth: index === 0 ? null : usable[ run.start ]!.viewport,
		maxWidth: null,
	} ) );
	for ( let index = 0; index < segments.length - 1; index++ ) {
		segments[ index ]!.maxWidth = segments[ index + 1 ]!.minWidth! - 1;
	}
	return { kind: 'segmented', segments };
}

/**
 * Express a segmented model as media-scoped stylesheet rules.
 *
 * An inline declaration cannot branch on viewport width, so the rules target
 * a stable attribute instead. The boundary sits on the first width where the
 * new regime was observed: stylesheets conventionally switch at the breakpoint
 * where the desktop rule begins, and every sampled width is governed by a rule
 * fitted to it.
 */
export function segmentedCss(
	selector: string,
	property: string,
	segments: readonly FluidModelSegment[]
): string {
	return segments
		.map( ( segment ) => {
			const conditions: string[] = [];
			if ( segment.minWidth !== null ) conditions.push( `(min-width:${ segment.minWidth }px)` );
			if ( segment.maxWidth !== null ) conditions.push( `(max-width:${ segment.maxWidth }px)` );
			// These rules stand in for the runtime's inline declaration, which
			// outranked every normal author rule. `!important` keeps that
			// precedence; without it a more specific author selector (a
			// `var()` fallback, say) silently wins at every width.
			const declaration = `${ selector } { ${ property }: ${ segment.model.css } !important; }`;
			if ( conditions.length === 0 ) return declaration;
			return `@media ${ conditions.join( ' and ' ) } {\n${ declaration }\n}`;
		} )
		.join( '\n' );
}
