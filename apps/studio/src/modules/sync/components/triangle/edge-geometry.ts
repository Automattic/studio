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
