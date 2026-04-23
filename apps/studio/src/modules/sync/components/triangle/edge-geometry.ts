export type Point = { x: number; y: number };

export type EdgeGeometry = {
	pathD: string;
	midpoint: Point;
	angleDeg: number;
	pushCenter: Point;
	pullCenter: Point;
};

/**
 * Compute SVG path and arrow-button placement for an edge connecting two points.
 *
 * - `pathD` is the SVG `d` attribute for a straight line from `a` to `b`.
 * - `angleDeg` is the CSS rotation to apply to a south-pointing glyph (↓) so that
 *   it ends up pointing along the line from `a` to `b`. Formula: `atan2(-dx, dy)`,
 *   which accounts for CSS's clockwise-positive convention in screen coordinates.
 * - `pushCenter` / `pullCenter` sit `offset` px on opposite perpendicular sides of
 *   the midpoint (push on the CW-90 side of the flow direction).
 */
export function computeEdgeGeometry( a: Point, b: Point, offset: number ): EdgeGeometry {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot( dx, dy ) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const perpX = uy; // CW-90 perpendicular to the direction vector.
	const perpY = -ux;
	const midpoint: Point = { x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 };
	const angleDeg = ( Math.atan2( -dx, dy ) * 180 ) / Math.PI || 0;
	return {
		pathD: `M ${ a.x } ${ a.y } L ${ b.x } ${ b.y }`,
		midpoint,
		angleDeg,
		pushCenter: { x: midpoint.x + perpX * offset, y: midpoint.y + perpY * offset },
		pullCenter: { x: midpoint.x - perpX * offset, y: midpoint.y - perpY * offset },
	};
}

/**
 * Compute a single L-shaped branch path from the T-point `(trunkX, midY)` out
 * to the target column, rounded outer corner, then down to `b`. Used for
 * per-branch animated overlays on top of the tree skeleton.
 *
 * Buttons sit on the descent leg between the bar and the target card.
 */
export function computeOrthogonalBranchGeometry(
	source: Point,
	midY: number,
	b: Point,
	offset: number,
	corner = 10
): EdgeGeometry {
	const dirX = Math.sign( b.x - source.x ) || 1;
	const dirY = Math.sign( b.y - midY ) || 1;
	const r = Math.min( corner, Math.abs( b.x - source.x ) / 2, Math.abs( b.y - midY ) / 2 );
	// Sweep matches the skeleton's outer fillet. Because the overlay traverses
	// the corner from the bar INTO the target (opposite direction to the
	// skeleton's U-bracket traversal), the sweep flag is flipped relative to
	// the skeleton: dirX * dirY > 0 → sweep=1, < 0 → sweep=0.
	const sweep = dirX * dirY > 0 ? 1 : 0;
	const pathD =
		`M ${ source.x } ${ source.y } ` +
		`V ${ midY } ` +
		`H ${ b.x - r * dirX } ` +
		`A ${ r } ${ r } 0 0 ${ sweep } ${ b.x } ${ midY + r * dirY } ` +
		`V ${ b.y }`;
	const legMidpoint: Point = { x: b.x, y: ( midY + b.y ) / 2 };
	return {
		pathD,
		midpoint: legMidpoint,
		angleDeg: 0,
		pushCenter: { x: legMidpoint.x + offset, y: legMidpoint.y },
		pullCenter: { x: legMidpoint.x - offset, y: legMidpoint.y },
	};
}

/**
 * Compute the SVG `d` for a Local-centered tree: one continuous U-bracket path
 * running from `leftTarget` up, across the horizontal bar (passing straight
 * through the trunk x-coordinate with no seam), and down to `rightTarget`; plus
 * a second subpath for the trunk from `source` straight down to `midY`.
 *
 * Rendering the bar as a single continuous stroke (instead of two strokes that
 * meet at the trunk) is what eliminates visible artifacts at the T-junction.
 */
export function computeTreeSkeletonPath(
	source: Point,
	leftTarget: Point,
	rightTarget: Point,
	midY: number,
	corner = 10
): string {
	const r = Math.min(
		corner,
		Math.abs( rightTarget.x - leftTarget.x ) / 2,
		Math.abs( leftTarget.y - midY ) / 2,
		Math.abs( rightTarget.y - midY ) / 2
	);
	const dirYLeft = Math.sign( leftTarget.y - midY ) || 1;
	const dirYRight = Math.sign( rightTarget.y - midY ) || 1;
	// Bar runs left→right. Both outer corners sweep the same way because both
	// targets sit below the bar.
	const leftSweep = dirYLeft > 0 ? 1 : 0;
	const rightSweep = dirYRight > 0 ? 1 : 0;
	const bar =
		`M ${ leftTarget.x } ${ leftTarget.y } ` +
		`V ${ midY + r * dirYLeft } ` +
		`A ${ r } ${ r } 0 0 ${ leftSweep } ${ leftTarget.x + r } ${ midY } ` +
		`H ${ rightTarget.x - r } ` +
		`A ${ r } ${ r } 0 0 ${ rightSweep } ${ rightTarget.x } ${ midY + r * dirYRight } ` +
		`V ${ rightTarget.y }`;
	const trunk = `M ${ source.x } ${ source.y } V ${ midY }`;
	return `${ bar } ${ trunk }`;
}
