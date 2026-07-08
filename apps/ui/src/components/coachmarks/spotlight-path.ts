export interface SpotlightRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * SVG path data for a full-viewport overlay with a rounded-rectangle hole cut
 * out of it (the Shepherd/driver.js technique). Rendered with
 * `fill-rule="evenodd"` so the inner subpath punches a real hole — the target
 * beneath stays visible and clickable. Returns just the outer rectangle when
 * there is no (or a degenerate) hole.
 */
export function makeSpotlightPath(
	viewport: { width: number; height: number },
	hole: SpotlightRect | null,
	radius: number
): string {
	const outer = `M0,0 H${ viewport.width } V${ viewport.height } H0 Z`;

	if ( ! hole || hole.width <= 0 || hole.height <= 0 ) {
		return outer;
	}

	// Clamp the hole to the viewport so an off-screen target can't produce a
	// broken path.
	const left = Math.max( 0, hole.x );
	const top = Math.max( 0, hole.y );
	const right = Math.min( viewport.width, hole.x + hole.width );
	const bottom = Math.min( viewport.height, hole.y + hole.height );
	const width = right - left;
	const height = bottom - top;

	if ( width <= 0 || height <= 0 ) {
		return outer;
	}

	const r = Math.max( 0, Math.min( radius, width / 2, height / 2 ) );

	const inner = [
		`M${ left + r },${ top }`,
		`H${ right - r }`,
		`A${ r },${ r } 0 0 1 ${ right },${ top + r }`,
		`V${ bottom - r }`,
		`A${ r },${ r } 0 0 1 ${ right - r },${ bottom }`,
		`H${ left + r }`,
		`A${ r },${ r } 0 0 1 ${ left },${ bottom - r }`,
		`V${ top + r }`,
		`A${ r },${ r } 0 0 1 ${ left + r },${ top }`,
		'Z',
	].join( ' ' );

	return `${ outer } ${ inner }`;
}
