// src/lib/screenshot/breakpoint-finder.ts
//
// Locate the widths where a source changes layout rule.
//
// Sampling fixed widths cannot do this: a breakpoint is a discontinuity
// *between* two widths, so fixed samples can only report "something changed
// somewhere in this gap". Worse, a fluid layout changes at every width, so a
// naive comparison flags all of them.
//
// The discriminator is ratio, not pixels. Under pure fluid scaling every
// element's x and width scale with the viewport, so `x / viewport` and
// `width / viewport` hold constant. At a real breakpoint those ratios jump —
// a two-column row becoming one column moves a width ratio from 0.5 to 1.0 —
// or elements appear, vanish, or reorder. So we scan coarsely for intervals
// containing a jump, then bisect each one to find its edge.
//
// The probe is injected, so the search is testable without a browser.

/**
 * Viewport-relative geometry keyed by stable element identity.
 *
 * Identity matters: comparing by document order breaks as soon as an element
 * crosses a size threshold or the sampling window shifts, which makes an
 * ordinary fluid page look like it changes at every width.
 */
export interface LayoutSignature {
	/** id -> [xRatio, widthRatio] for elements laid out at this width. */
	boxes: Record< string, [ number, number ] >;
}

export interface BreakpointSearchOptions {
	/** Narrowest width to consider. */
	min?: number;
	/** Widest width to consider. */
	max?: number;
	/** Initial scan positions. Intervals between them are bisected. */
	coarse?: number[];
	/** Stop bisecting once an interval is this narrow, in px. */
	precision?: number;
	/** Ratio change below this is fluid scaling, not a breakpoint. */
	tolerance?: number;
	/** Safety valve on total probes, since each costs a resize and settle. */
	maxProbes?: number;
}

export const DEFAULT_COARSE_WIDTHS = [ 360, 480, 640, 768, 900, 1024, 1280, 1440, 1920 ];

/** Share of elements that must change visibility before that alone is discrete. */
const VISIBILITY_CHANGE_THRESHOLD = 0.1;

/**
 * Deviation from affine behavior, in CSS pixels, at the midpoint of a range.
 *
 * Within one responsive region an element's geometry is affine in viewport
 * width: `value = fixed + proportional * width`. That covers the mixed layouts
 * real sites use — a fixed max-width container, fixed gutters around a fluid
 * column — all of which change *continuously* as the viewport grows. Equality
 * of ratios does not hold for any of them, which is why comparing ratios flags
 * every width as a breakpoint.
 *
 * A breakpoint is where that continuity breaks, so the test is whether the
 * midpoint lands where interpolating the endpoints predicts.
 */
export function interpolationError(
	low: { width: number; signature: LayoutSignature },
	mid: { width: number; signature: LayoutSignature },
	high: { width: number; signature: LayoutSignature }
): number {
	const span = high.width - low.width;
	if ( span <= 0 ) return 0;
	const t = ( mid.width - low.width ) / span;

	let worst = 0;
	let shared = 0;
	const ids = Object.keys( mid.signature.boxes );
	for ( const id of ids ) {
		const a = low.signature.boxes[ id ];
		const b = high.signature.boxes[ id ];
		const m = mid.signature.boxes[ id ];
		if ( ! a || ! b || ! m ) continue;
		shared++;
		for ( let axis = 0; axis < 2; axis++ ) {
			// Endpoints are ratios; compare in pixels at the midpoint width.
			const predicted = ( a[ axis ]! * low.width + t * ( b[ axis ]! * high.width - a[ axis ]! * low.width ) );
			const actual = m[ axis ]! * mid.width;
			worst = Math.max( worst, Math.abs( actual - predicted ) );
		}
	}

	const union = new Set( [
		...Object.keys( low.signature.boxes ),
		...Object.keys( high.signature.boxes ),
		...ids,
	] ).size;
	const changed = union - shared;
	if ( union > 0 && changed / union > VISIBILITY_CHANGE_THRESHOLD ) return Number.POSITIVE_INFINITY;
	return shared === 0 ? Number.POSITIVE_INFINITY : worst;
}

/**
 * How different two layouts are, ignoring uniform scaling.
 *
 * Elements are matched by identity and only those laid out at both widths are
 * compared, so a single element crossing a threshold cannot masquerade as a
 * layout change. Wholesale appearance or disappearance is discrete on its own,
 * but only past a share of the page.
 */
export function signatureDistance( a: LayoutSignature, b: LayoutSignature ): number {
	const aIds = Object.keys( a.boxes );
	const bIds = Object.keys( b.boxes );
	if ( aIds.length === 0 || bIds.length === 0 ) return aIds.length === bIds.length ? 0 : Number.POSITIVE_INFINITY;

	let worst = 0;
	let shared = 0;
	for ( const id of aIds ) {
		const other = b.boxes[ id ];
		if ( ! other ) continue;
		shared++;
		const mine = a.boxes[ id ]!;
		worst = Math.max( worst, Math.abs( mine[ 0 ] - other[ 0 ] ), Math.abs( mine[ 1 ] - other[ 1 ] ) );
	}

	const union = new Set( [ ...aIds, ...bIds ] ).size;
	const changed = union - shared;
	if ( union > 0 && changed / union > VISIBILITY_CHANGE_THRESHOLD ) return Number.POSITIVE_INFINITY;
	return shared === 0 ? Number.POSITIVE_INFINITY : worst;
}

/**
 * Find the widths at which layout rule changes, by bisecting the intervals
 * where the ratio signature jumps.
 *
 * Each returned breakpoint is the narrowest width at which the *new* layout
 * applies, matching how CSS `min-width` queries are written.
 */
export async function findBreakpoints(
	probe: ( width: number ) => Promise< LayoutSignature >,
	options: BreakpointSearchOptions = {}
): Promise< { breakpoints: number[]; probes: number } > {
	const min = options.min ?? 320;
	const max = options.max ?? 1920;
	const precision = Math.max( 1, options.precision ?? 8 );
	// Pixels of deviation from affine behavior. Sub-pixel rounding and text
	// reflow move things a little without changing the layout rule.
	const tolerance = options.tolerance ?? 6;
	const maxProbes = options.maxProbes ?? 60;
	const coarse = ( options.coarse ?? DEFAULT_COARSE_WIDTHS )
		.filter( ( width ) => width >= min && width <= max )
		.sort( ( a, b ) => a - b );
	if ( coarse.length < 2 ) return { breakpoints: [], probes: 0 };

	const cache = new Map< number, LayoutSignature >();
	let probes = 0;
	const measure = async ( width: number ): Promise< LayoutSignature > => {
		const cached = cache.get( width );
		if ( cached ) return cached;
		probes++;
		const signature = await probe( width );
		cache.set( width, signature );
		return signature;
	};
	const at = async ( width: number ) => ( { width, signature: await measure( width ) } );

	const breakpoints: number[] = [];

	/** Narrow an interval known to contain a discontinuity down to its edge. */
	const bisect = async ( lowWidth: number, highWidth: number ): Promise< void > => {
		let low = lowWidth;
		let high = highWidth;
		while ( high - low > precision && probes < maxProbes ) {
			const mid = Math.floor( ( low + high ) / 2 );
			if ( mid <= low || mid >= high ) break;
			const [ a, m, b ] = [ await at( low ), await at( mid ), await at( high ) ];
			// Whichever half still fails the affine test contains the edge.
			const lowerHalf = await at( Math.floor( ( low + mid ) / 2 ) );
			if ( interpolationError( a, lowerHalf, m ) > tolerance ) {
				high = mid;
				continue;
			}
			if ( interpolationError( m, await at( Math.floor( ( mid + high ) / 2 ) ), b ) > tolerance ) {
				low = mid;
				continue;
			}
			// Neither half is discontinuous: the edge sits at the midpoint.
			low = mid - 1;
			high = mid;
			break;
		}
		if ( ! breakpoints.includes( high ) ) breakpoints.push( high );
	};

	for ( let index = 1; index < coarse.length; index++ ) {
		if ( probes >= maxProbes ) break;
		const low = coarse[ index - 1 ]!;
		const high = coarse[ index ]!;
		const mid = Math.floor( ( low + high ) / 2 );
		if ( mid <= low || mid >= high ) continue;
		const error = interpolationError( await at( low ), await at( mid ), await at( high ) );
		if ( error <= tolerance ) continue;
		await bisect( low, high );
	}

	return { breakpoints: breakpoints.sort( ( a, b ) => a - b ), probes };
}

export const BREAKPOINT_ID_ATTRIBUTE = 'data-dla-bp-id';

/** Assign stable identities once, before any resizing, so ids survive reflow. */
export function tagElementsScript( limit = 400 ): string {
	return `(() => {
		let index = 0;
		for ( const element of [ ...document.querySelectorAll( 'body *' ) ].slice( 0, ${ limit } ) ) {
			element.setAttribute( '${ BREAKPOINT_ID_ATTRIBUTE }', String( index++ ) );
		}
		return index;
	})()`;
}

/** Read viewport-relative geometry for the tagged elements at the current width. */
export function layoutSignatureScript( minWidth = 24, minHeight = 12 ): string {
	return `(() => {
		const boxes = {};
		const vw = window.innerWidth || 1;
		for ( const element of document.querySelectorAll( '[${ BREAKPOINT_ID_ATTRIBUTE }]' ) ) {
			const rect = element.getBoundingClientRect();
			if ( rect.width < ${ minWidth } || rect.height < ${ minHeight } ) continue;
			boxes[ element.getAttribute( '${ BREAKPOINT_ID_ATTRIBUTE }' ) ] = [ rect.x / vw, rect.width / vw ];
		}
		return { boxes };
	})()`;
}

/** Remove the identity markers so they never reach a captured artifact. */
export function untagElementsScript(): string {
	return `(() => {
		for ( const element of document.querySelectorAll( '[${ BREAKPOINT_ID_ATTRIBUTE }]' ) ) {
			element.removeAttribute( '${ BREAKPOINT_ID_ATTRIBUTE }' );
		}
	})()`;
}
